const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const Parser = require('rss-parser');
const router = express.Router();

const parser = new Parser();

// ニュースローテーション管理
let newsHistory = [];
const MAX_HISTORY = 15; // 履歴保持数
let lastResetDate = null; // 最後にリセットした日付

// カテゴリ別検索キーワード
const CATEGORY_KEYWORDS = {
    lifestyle: "Japan lifestyle trending popular viral",
    society: "Japan society culture trending popular",
    economy: "Japan economy business trending", 
    entertainment: "Japan entertainment celebrity movies music anime trending popular viral",
    tech: "Japan technology innovation trending popular",
    all: "Japan trending popular viral news"
};

// レベル別設定
const LEVEL_CONFIG = {
    beginner: { wordCount: 600, speed: 0.9, cefr: "A2", complexity: "simple" },
    intermediate: { wordCount: 3000, speed: 1.0, cefr: "B1", complexity: "moderate" },
    advanced: { wordCount: 5000, speed: 1.0, cefr: "C1", complexity: "advanced" }
};

// OpenAI API設定
const openaiClient = axios.create({
    baseURL: process.env.OPENAI_BASE_URL,
    headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 60000 // 60秒に延長
});

// ニュース検索エンドポイント
router.post('/search', async (req, res) => {
    try {
        const { level, categories } = req.body;
        
        if (!level || !categories || !Array.isArray(categories)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'level and categories are required'
            });
        }

        console.log(`📰 Searching news - Level: ${level}, Categories: ${categories.join(', ')}`);
        
        // 検索クエリ生成
        const searchQueries = generateSearchQueries(level, categories);
        
        // 各カテゴリでニュースを検索（複数回実行して多様性を確保）
        const allArticles = [];
        
        // 複数ソースから若者向けニュースを取得（より多様性のため増量）
        const newsSourceQueries = [
            { source: 'yahoo_entertainment', limit: 5 },
            { source: 'yahoo_sports', limit: 5 }, 
            { source: 'nhk', limit: 5 },
            { source: 'yahoo_general', limit: 5 },
            { source: 'asahi', limit: 5 }
        ];
        
        for (const sourceQuery of newsSourceQueries) {
            try {
                const articles = await searchNewsFromSource(sourceQuery);
                allArticles.push(...articles);
            } catch (error) {
                console.log(`⚠️ ${sourceQuery.source} RSS取得失敗: ${error.message}`);
            }
        }
        
        // 重複排除
        const uniqueArticles = removeDuplicateArticles(allArticles);
        
        // ニュースローテーション適用
        const rotatedArticles = applyNewsRotation(uniqueArticles);
        
        // 5件を確保
        let selectedArticles = rotatedArticles.slice(0, 5);
        
        console.log(`📰 重複排除後: ${uniqueArticles.length}件, ローテーション後: ${rotatedArticles.length}件, 選択: ${selectedArticles.length}件`);
        
        // 軽量化: 記事タイトルのみ英語化（詳細は後で）
        const lightweightArticles = [];
        for (const article of selectedArticles) {
            const lightweight = await processArticleTitle(article, level);
            lightweightArticles.push(lightweight);
        }
        
        console.log(`✅ Found ${lightweightArticles.length} articles`);
        
        // ニュース履歴を更新
        updateNewsHistory(lightweightArticles);
        
        res.json({
            success: true,
            articles: lightweightArticles,
            count: lightweightArticles.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('News search error:', error);
        res.status(500).json({
            error: 'Search Failed',
            message: 'Failed to fetch news articles'
        });
    }
});

// 検索クエリ生成
function generateSearchQueries(level, categories) {
    const queries = [];
    const today = new Date().toISOString().split('T')[0];
    
    if (categories.includes('all')) {
        // 全カテゴリーの場合
        Object.keys(CATEGORY_KEYWORDS).forEach(category => {
            if (category !== 'all') {
                queries.push({
                    category: category,
                    keywords: CATEGORY_KEYWORDS[category],
                    date: today,
                    level: level,
                    limit: 2
                });
            }
        });
    } else {
        // 選択されたカテゴリーのみ
        categories.forEach(category => {
            queries.push({
                category: category,
                keywords: CATEGORY_KEYWORDS[category] || CATEGORY_KEYWORDS.all,
                date: today,
                level: level,
                limit: 5 // 各カテゴリから十分な数を取得
            });
        });
    }
    
    return queries;
}

// 複数ソースからニュース取得（若者向け）
async function searchNewsFromSource(sourceQuery) {
    const { source, limit } = sourceQuery;
    console.log(`🔍 ${source} RSS検索開始`);
    
    try {
        let rssUrl, sourceName;
        
        // ソースに応じてRSSフィードを選択
        switch (source) {
            case 'yahoo_entertainment':
                rssUrl = process.env.YAHOO_RSS_ENTERTAINMENT;
                sourceName = 'Yahoo! エンタメ';
                break;
            case 'yahoo_sports':
                rssUrl = process.env.YAHOO_RSS_SPORTS;
                sourceName = 'Yahoo! スポーツ';
                break;
            case 'yahoo_general':
                rssUrl = process.env.YAHOO_RSS_URL;
                sourceName = 'Yahoo! News';
                break;
            case 'nhk':
                rssUrl = process.env.NHK_RSS_URL;
                sourceName = 'NHK News';
                break;
            case 'asahi':
                rssUrl = process.env.ASAHI_RSS_URL;
                sourceName = '朝日新聞';
                break;
            default:
                throw new Error(`Unknown source: ${source}`);
        }
        
        // RSS URLが設定されているかチェック
        if (!rssUrl) {
            throw new Error(`RSS URL not configured for source: ${source}. Check environment variables.`);
        }
        
        console.log(`🌐 RSS URL: ${rssUrl}`);
        
        // RSSを取得
        const feed = await parser.parseURL(rssUrl);
        console.log(`📰 ${sourceName}から${feed.items.length}件のニュースを取得`);
        
        if (feed.items && feed.items.length > 0) {
            // 若者向けニュースフィルタリング
            let filteredItems = filterYouthInterestNews(feed.items, source);
            
            // 記事をフォーマット（日付の妥当性チェック付き）
            const articles = filteredItems.slice(0, limit).map(item => {
                let publishedDate = item.pubDate || new Date().toISOString();
                
                // 日付の妥当性をチェック
                try {
                    const date = new Date(publishedDate);
                    const now = new Date();
                    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    
                    // 無効な日付や未来の日付、1週間以上古い日付の場合は今日の日付を使用
                    if (isNaN(date.getTime()) || date > now || date < oneWeekAgo) {
                        publishedDate = new Date().toISOString();
                    }
                } catch (error) {
                    publishedDate = new Date().toISOString();
                }
                
                return {
                    title_ja: item.title,
                    url: item.link,
                    published_at: publishedDate,
                    summary_ja: item.contentSnippet || item.content || item.title,
                    content_ja: item.content || item.contentSnippet || item.title,
                    // 追加の詳細情報を保持
                    description: item.description || '',
                    author: item.author || '',
                    guid: item.guid || '',
                    categories: item.categories || [],
                    source: sourceName,
                    category: source.includes('entertainment') ? 'entertainment' : 
                             source.includes('sports') ? 'sports' : 'general',
                    isFallback: false // 実際のニュース
                };
            });

            return articles;
        } else {
            throw new Error(`No news items in ${sourceName} RSS feed`);
        }
    } catch (error) {
        console.error(`❌ ${source} RSS error:`, {
            message: error.message,
            stack: error.stack,
            url: rssUrl,
            source: source
        });
        
        // より詳細なエラー情報を出力
        if (error.response) {
            console.error(`HTTP Response:`, error.response.status, error.response.statusText);
        }
        
        throw new Error(`${source} RSS failed: ${error.message}`);
    }
}

// 若者向けニュースフィルタリング（20代-30代）
function filterYouthInterestNews(items, source) {
    // エンタメ・スポーツソースはそのまま
    if (source.includes('entertainment') || source.includes('sports')) {
        return items;
    }
    
    // 一般ニュースは若者が興味を持ちそうなキーワードでフィルタ
    const youthKeywords = [
        // テクノロジー・IT
        'AI', '人工知能', 'ChatGPT', 'SNS', 'Twitter', 'Instagram', 'TikTok', 'YouTube', 'ゲーム', 'アプリ', 'スマホ', 'iPhone', 'Android',
        // エンタメ・文化
        'アニメ', '漫画', '映画', '音楽', 'アーティスト', '俳優', '女優', 'アイドル', 'K-POP', 'ドラマ', 'Netflix', 'Amazon',
        // ライフスタイル
        '恋愛', '結婚', '就職', '転職', '副業', '投資', '仮想通貨', 'バイト', '学生', '大学', '一人暮らし', 'カフェ', 'グルメ', '旅行',
        // 社会問題（若者関心）
        '少子化', '年金', '税金', '物価', '給料', '働き方', 'ブラック企業', 'ワークライフバランス', '環境', 'SDGs',
        // スポーツ・健康
        'オリンピック', 'ワールドカップ', '野球', 'サッカー', 'バスケ', 'テニス', 'ダイエット', '筋トレ', 'ジム'
    ];
    
    return items.filter(item => {
        try {
            // デバッグ情報を追加
            console.log(`🔍 フィルタリング中: item =`, typeof item, item ? Object.keys(item).slice(0, 5) : 'null/undefined');
            
            // アイテムが存在しない場合はスキップ
            if (!item || typeof item !== 'object') {
                console.log(`⚠️ 無効なアイテム:`, item);
                return false;
            }
            
            // タイトルとコンテンツの安全な取得
            const title = item.title ? String(item.title).toLowerCase() : '';
            const content = item.contentSnippet ? String(item.contentSnippet).toLowerCase() : 
                           item.content ? String(item.content).toLowerCase() : '';
            
            console.log(`📝 タイトル: "${title.slice(0, 50)}..." コンテンツ: "${content.slice(0, 30)}..."`);
            
            // 空のタイトルまたはコンテンツをスキップ
            if (!title && !content) {
                console.log(`⚠️ 空のタイトル・コンテンツ`);
                return false;
            }
            
            const hasKeyword = youthKeywords.some(keyword => {
                const lowerKeyword = keyword.toLowerCase();
                return title.includes(lowerKeyword) || content.includes(lowerKeyword);
            });
            
            console.log(`🎯 キーワード該当: ${hasKeyword}`);
            return hasKeyword;
            
        } catch (error) {
            console.error(`❌ フィルタリングエラー:`, error.message, `item:`, item);
            return false;
        }
    });
}

// 日付ベースの履歴リセット
function checkAndResetDailyHistory() {
    const today = new Date().toDateString(); // "Mon Dec 25 2023" 形式
    
    if (lastResetDate !== today) {
        console.log(`📅 日付変更検出: ${lastResetDate} → ${today}`);
        console.log(`🗑️ ニュース履歴をリセットします (${newsHistory.length}件削除)`);
        
        // 履歴を完全クリア
        newsHistory = [];
        lastResetDate = today;
        
        console.log(`✨ 新しい日のニュースローテーション開始`);
    }
}

// ニュースローテーション機能（完全に異なるニュースのみ返す）
function applyNewsRotation(articles) {
    // まず日付ベースのリセットをチェック
    checkAndResetDailyHistory();
    
    // 履歴と比較して新しいニュースのみを返す
    const currentUrls = newsHistory.map(item => item.url);
    
    // 未使用のニュースのみを抽出
    const unusedNews = articles.filter(article => !currentUrls.includes(article.url));
    const usedNews = articles.filter(article => currentUrls.includes(article.url));
    
    console.log(`🔄 ローテーション: 未使用 ${unusedNews.length}件, 使用済み ${usedNews.length}件`);
    
    // 未使用のニュースが5件以上ある場合はそれのみを返す
    if (unusedNews.length >= 5) {
        console.log(`✅ 十分な未使用ニュースあり: ${unusedNews.length}件から5件選択`);
        return unusedNews;
    }
    
    // 未使用ニュースが5件未満の場合は履歴をクリアして再利用可能にする
    if (unusedNews.length < 5) {
        console.log(`⚠️ 未使用ニュース不足: ${unusedNews.length}件のみ。履歴を部分クリアします`);
        
        // 履歴の古い半分を削除して再利用可能にする
        const halfHistorySize = Math.floor(newsHistory.length / 2);
        const recentHistory = newsHistory.slice(0, halfHistorySize);
        const clearedUrls = newsHistory.slice(halfHistorySize).map(item => item.url);
        
        // 履歴を更新
        newsHistory = recentHistory;
        
        // クリアされた記事を再利用可能として追加
        const reusableNews = articles.filter(article => 
            clearedUrls.includes(article.url) || !recentHistory.some(h => h.url === article.url)
        );
        
        console.log(`🔄 履歴クリア後: 利用可能 ${reusableNews.length}件`);
        
        return reusableNews;
    }
    
    return unusedNews;
}

// ニュース履歴を更新
function updateNewsHistory(selectedArticles) {
    // まず日付ベースのリセットをチェック
    checkAndResetDailyHistory();
    
    // 新しく選択された記事を履歴に追加
    const newHistoryItems = selectedArticles.map(article => ({
        url: article.url,
        title: article.title_ja,
        timestamp: new Date().toISOString(),
        date: new Date().toDateString() // 日付情報も保存
    }));
    
    // 履歴に追加して制限数を超えた場合は古いものを削除
    newsHistory = [...newHistoryItems, ...newsHistory].slice(0, MAX_HISTORY);
    
    console.log(`📚 ニュース履歴更新: ${newsHistory.length}件保持 (日付: ${new Date().toDateString()})`);
}

// 軽量記事処理（タイトルのみ英語化）
async function processArticleTitle(article, level) {
    console.log(`🏃‍♂️ 軽量処理: "${article.title_ja}"`);
    
    const config = LEVEL_CONFIG[level];
    
    const prompt = `Translate this Japanese news title to English for ${config.cefr} level learners:
"${article.title_ja}"

Return ONLY a simple JSON object:
{
  "en_title": "English title (max 80 characters, ${config.cefr} vocabulary)"
}`;

    try {
        console.log(`🤖 タイトル翻訳API呼び出し中...`);
        
        const response = await openaiClient.post('/chat/completions', {
            model: process.env.GPT_MODEL || 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: 'You are a title translator. Return only valid JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 150
        });

        console.log(`✅ タイトル翻訳完了`);
        const content = response.data.choices[0].message.content.trim();
        console.log(`📝 GPT-5レスポンス内容:`, content);
        
        let titleData;
        try {
            const jsonMatch = content.match(/\{.*?\}/s);
            if (jsonMatch) {
                console.log(`📄 JSONマッチ:`, jsonMatch[0]);
                titleData = JSON.parse(jsonMatch[0]);
            } else {
                console.log(`📄 直接パース試行`);
                titleData = JSON.parse(content);
            }
            console.log(`🎯 パース結果:`, titleData);
        } catch (parseError) {
            console.log(`❌ JSONパースエラー:`, parseError.message);
            titleData = { en_title: article.title_ja };
        }

        return {
            ...article,
            en_title: titleData.en_title,
            level: level,
            processed_at: new Date().toISOString(),
            lightweight: true  // フラグを追加
        };

    } catch (error) {
        console.error('❌ タイトル処理エラー詳細:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                model: process.env.GPT_MODEL
            }
        });
        return {
            ...article,
            en_title: article.title_ja,
            level: level,
            lightweight: true
        };
    }
}

// 記事内容を整形（レベル別英文化）
async function processArticleContent(article, level) {
    console.log(`📝 記事整形開始: "${article.title_ja}" (レベル: ${level})`);
    
    const config = LEVEL_CONFIG[level];
    const wordCountMin = 100;
    const wordCountMax = 150;
    
    const prompt = `You are an English learning content generator for Japanese students.
Transform this Japanese news article into English content suitable for ${config.cefr} level learners.

Original Article:
Title: ${article.title_ja}
Content: ${article.content_ja}
Description: ${article.description || ''}
Author: ${article.author || ''}
Source: ${article.source}
Category: ${article.category}
Published Date: ${article.published_at}
URL: ${article.url || ''}

CRITICAL REQUIREMENTS FOR SPECIFICITY AND ACCURACY:
1. Extract and preserve ALL specific information from the original:
   - Personal names (人名): Keep exact names, convert to English spelling if needed
   - Company/Organization names (組織名): Preserve exactly
   - Location names (地名): Keep specific cities, prefectures, countries
   - Dates and times (日時): Include when events happened (yesterday, today, specific dates)
   - Numbers and statistics (数値): Ages, amounts, quantities, percentages
   - Event details (詳細): What specifically happened, where, when, who was involved

2. Make the English article CONCRETE and SPECIFIC:
   - Use specific names instead of general terms
   - Include timeframes ("yesterday", "last week", "on August 15th")
   - Mention exact locations and numbers
   - Describe specific actions and events

Create learning content with ${config.complexity} language complexity.

Return ONLY this JSON structure:
{
  "en_title": "English title (max 80 characters, include specific names/details)",
  "en_body": "English article body (${wordCountMin}-${wordCountMax} words, MUST include specific names, dates, locations, numbers from original article)",
  "ja_translation": "Complete Japanese translation of the en_body",
  "vocab_glossary": [
    {
      "headword": "vocabulary word",
      "meaning_ja": "Japanese meaning"
    }
  ]
}

ABSOLUTE REQUIREMENTS:
- Include specific personal names, company names, location names from the original
- Mention when events occurred (specific dates or timeframes)
- Include all numerical data (ages, amounts, statistics)
- Do NOT use vague terms like "a company", "someone", "recently" - use specific names and dates
- Extract maximum concrete details from the original Japanese content
- Use vocabulary appropriate for ${config.cefr} level
- Make sentences ${config.complexity} but clear
- Ensure en_body is exactly 100-150 words and flows naturally`;

    try {
        console.log(`🤖 記事整形API呼び出し中... (${config.cefr}レベル, ${wordCountMin}-${wordCountMax}語)`);
        
        const response = await openaiClient.post('/chat/completions', {
            model: process.env.GPT_MODEL || 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert English language learning content creator specializing in creating SPECIFIC and CONCRETE news articles. CRITICAL: You must extract and include ALL specific details from the original Japanese article - every name, date, location, number, and concrete fact. Never use vague terms like "someone", "a company", "recently" - always use the specific names and dates from the original. Your goal is to create detailed, factual English content for ${config.cefr} level learners. Always return valid JSON only, no other text.`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.4,
            max_tokens: 3000
        });

        console.log(`✅ 記事整形API応答受信 - トークン使用量: ${response.data.usage?.total_tokens || 'N/A'}`);
        const content = response.data.choices[0].message.content.trim();
        
        let processedContent;
        try {
            // ```json で囲まれている場合の処理
            const jsonMatch = content.match(/```json\s*(\{.*?\})\s*```/s);
            if (jsonMatch) {
                console.log(`📄 整形JSONブロックから抽出: ${jsonMatch[1].length}文字`);
                processedContent = JSON.parse(jsonMatch[1]);
            } else {
                console.log(`📄 直接整形JSONパース: ${content.length}文字`);
                processedContent = JSON.parse(content);
            }
            console.log(`🎯 記事整形完了: "${processedContent.en_title}" (${processedContent.en_body?.split(' ').length || 0}語)`);
        } catch (parseError) {
            console.warn(`❌ 記事整形JSON parse error: ${parseError.message}, フォールバックコンテンツを使用`);
            console.log(`📝 整形応答内容: ${content.substring(0, 200)}...`);
            processedContent = generateFallbackProcessedContent(article, config);
        }

        return {
            ...article,
            ...processedContent,
            processed_at: new Date().toISOString(),
            level: level,
            word_count: processedContent.en_body ? processedContent.en_body.split(' ').length : 0
        };

    } catch (error) {
        console.error('Article processing error:', error.message);
        return {
            ...article,
            ...generateFallbackProcessedContent(article, config),
            processed_at: new Date().toISOString(),
            level: level
        };
    }
}

// 重複排除
function removeDuplicateArticles(articles) {
    const seen = new Set();
    const unique = [];
    
    for (const article of articles) {
        // URL正規化
        const normalizedUrl = normalizeUrl(article.url);
        const urlHash = hashString(normalizedUrl);
        
        // URL重複のみチェック（タイトル重複は許可）
        if (!seen.has(urlHash)) {
            seen.add(urlHash);
            unique.push(article);
        }
    }
    
    // 公開日順にソート（新しい順）
    return unique.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
}

// ユーティリティ関数
function normalizeUrl(url) {
    return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
}

function hashString(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

function generateArticleId(url, title) {
    return crypto.createHash('md5').update(url + title).digest('hex').substring(0, 16);
}

// フォールバック用モックデータ生成
function generateFallbackNewsData(query) {
    console.log(`⚠️ フォールバックデータ生成中 - カテゴリ: ${query.category}, 件数: ${query.limit}`);
    
    const mockTitles = {
        lifestyle: [
            '東京都、2024年度の子育て支援金を月額15,000円に増額を発表',
            '大阪市で新型認知症予防プログラム開始、参加者1万人募集',
            '全国の地方移住者数が過去最高の12万人を記録、総務省調査'
        ],
        society: [
            '最高裁、同性婚の法的保護について憲法判断、来月判決予定',
            '厚生労働省、少子化対策として新制度「育児休業3年制」検討開始',
            '外国人技能実習制度見直し、新制度では労働者の権利を大幅強化'
        ],
        economy: [
            '日銀、政策金利を0.25%に引き上げ決定、17年ぶりの利上げ',
            'トヨタ自動車、2024年度決算で過去最高益38兆円達成',
            '円安進行でGDP押し上げ効果、内閣府が今年度成長率2.1%に上方修正'
        ],
        entertainment: [
            '宮崎駿監督の新作アニメ「君たちはどう生きるか」続編制作決定',
            'BTS、5年ぶり東京ドーム公演で15万人動員、経済効果500億円',
            '映画「シン・ゴジラ2」製作発表、庵野秀明監督が続投'
        ],
        tech: [
            'ソフトバンク、生成AI特化データセンターに2兆円投資発表',
            'トヨタとNTT、自動運転技術で資本業務提携、共同開発加速',
            '経産省、半導体戦略で台湾TSMC熊本工場に追加支援3000億円'
        ]
    };
    
    const titles = mockTitles[query.category] || ['最新ニュース'];
    
    const detailedContent = {
        lifestyle: [
            '東京都の小池百合子知事は14日、都庁で記者会見を開き、2024年度から子育て支援金を現行の月額10,000円から15,000円に増額すると発表した。対象は18歳未満の子どもを持つ世帯で、年収800万円以下の家庭約50万世帯が対象となる。都は財源として、法人事業税の超過課税分を充当し、年間総額で約900億円を投じる予定。支援金の増額により、少子化対策の強化と子育て世帯の経済負担軽減を図る。申請は来月から開始され、既存の受給者には自動的に増額分が支給される。',
            '大阪市は13日、65歳以上の高齢者を対象とした認知症予防プログラム「ブレインケア・プラス」を来月から開始すると発表した。同プログラムは週2回、市内50箇所の公民館で実施され、参加者1万人を募集する。内容は有酸素運動、認知トレーニング、栄養指導を組み合わせたもので、大阪大学医学部との共同研究として効果検証も行う。参加費は月額3,000円で、70歳以上は半額に減額される。市は3年間で認知症発症リスクを30%削減することを目標としている。',
            '総務省は12日、2023年度の地方移住者数が過去最高の12万3,456人に達したと発表した。前年度比18%増となり、コロナ禍をきっかけとしたテレワークの普及が背景にある。移住先として人気が高いのは長野県（8,234人）、静岡県（7,891人）、山梨県（6,543人）の順。年代別では30代が最も多く全体の35%を占め、IT関連職種の移住者が前年度比42%増加した。政府は地方創生の観点から、移住支援金制度の拡充を検討している。'
        ],
        society: [
            '最高裁判所は15日、同性カップルの法的保護に関する憲法判断について、来月27日に大法廷で判決を言い渡すと発表した。この裁判は、同性婚を認めないことが憲法14条の平等原則に反するかが争点となっている。全国13の地方裁判所で類似の訴訟が起こされており、今回の最高裁判決が全国の判例に大きな影響を与える見通し。法務省によると、現在全国で約3万組の同性カップルがパートナーシップ制度に登録している。判決によっては民法改正の議論が本格化する可能性がある。',
            '厚生労働省は14日、少子化対策の一環として「育児休業3年制」の導入検討を開始したと発表した。現行の1年間から3年間に延長し、給付金も現在の67%から80%に引き上げる方針。対象は第2子以降の出産とし、財源は雇用保険料の引き上げと国庫負担の増額で賄う。同省の試算では、制度導入により出生率が現在の1.26から1.35に改善すると予測している。経済界からは人材確保への懸念の声も上がっており、企業への代替要員確保支援制度も併せて検討される。',
            '法務省は13日、外国人技能実習制度を抜本的に見直し、新制度「特定技能育成プログラム」に移行すると発表した。現行制度での労働者の権利制限や転職禁止などの問題を受け、新制度では同一職種内での転職を認め、労働条件の改善を義務付ける。また、最低賃金の1.2倍以上の給与支払いを条件とし、違反企業には5年間の受け入れ停止処分を科す。対象職種も現在の82職種から120職種に拡大され、IT分野や介護分野での受け入れを強化する。'
        ],
        economy: [
            '日本銀行は12日の金融政策決定会合で、政策金利を現行のマイナス0.1%から0.25%に引き上げることを8対1の賛成多数で決定した。利上げは2007年以来17年ぶりとなる。植田和男総裁は記者会見で「物価上昇率が2%目標を安定的に達成する見通しが立った」と説明した。市場では円高圧力が強まり、午後の外国為替市場で円相場は一時1ドル=145円台まで上昇。株式市場では金融株が買われる一方、不動産株が売られる展開となった。',
            'トヨタ自動車は11日、2024年3月期の連結決算を発表し、売上高が前期比24.3%増の37兆9,874億円、純利益が同78.3%増の4兆9,444億円となり、いずれも過去最高を更新した。円安効果と北米市場でのハイブリッド車好調が寄与した。佐藤恒治社長は「電動化投資を加速し、2030年までに年間350万台のEV生産体制を構築する」と述べた。また、株主還元として1株当たり配当を50円増配し、年間配当を300円とする方針も発表した。',
            '内閣府は10日、2024年度の実質GDP成長率見通しを従来の1.4%から2.1%に上方修正したと発表した。円安による輸出増加と、インバウンド観光の本格回復が主な要因。民間消費も賃上げ効果により堅調に推移している。一方、消費者物価上昇率は年平均2.8%と予測され、日銀の2%目標を上回る見込み。政府は物価高対策として、低所得世帯への給付金7万円の追加支給と、ガソリン価格抑制策の延長を検討している。'
        ],
        entertainment: [
            'スタジオジブリは15日、宮崎駿監督（83）の長編アニメーション最新作「君たちはどう生きるか」の続編制作を正式発表した。続編のタイトルは「風の又三郎と星の子」で、2027年夏の公開を予定している。宮崎監督は「まだ伝えたいことがある」とコメント。制作費は前作を上回る150億円規模となる見込みで、海外配給権についてもディズニーとの交渉が進んでいる。前作は世界興行収入460億円を記録し、アカデミー賞長編アニメーション部門を受賞している。',
            '韓国の人気グループBTSが14日、5年ぶりとなる東京ドーム公演を開催し、3日間で延べ15万人のファンを動員した。チケットは発売開始1分で完売し、倍率は約50倍に達した。コンサートの経済効果は宿泊、飲食、グッズ販売を含めて約500億円と推計される。メンバーのRMは「日本のファンとの再会を心から楽しみにしていた」と日本語でコメント。来年は大阪、名古屋での追加公演も予定されており、総動員数は30万人を超える見込み。',
            '東宝は13日、特撮映画「シン・ゴジラ」の続編「シン・ゴジラ2：復活」の製作を正式発表した。庵野秀明監督が続投し、2026年夏の公開を予定している。製作費は前作の2倍となる80億円規模で、IMAXでの同時上映も決定している。新たなキャストとして長澤まさみ、岡田准一の出演が内定している。前作は興行収入82億円のヒットを記録し、第40回日本アカデミー賞で最優秀作品賞を受賞した。'
        ],
        tech: [
            'ソフトバンクグループは14日、生成AI専用データセンターの構築に今後5年間で2兆円を投資すると発表した。千葉県、愛知県、大阪府の3箇所に大規模施設を建設し、2027年までに稼働開始予定。孫正義会長兼社長は「日本をAI先進国にする」と述べ、エヌビディアとの戦略的パートナーシップも拡大する。施設では最新のH100 GPUを10万基以上設置し、国内最大級のAI計算能力を提供する。また、AI人材育成のため東京大学との共同研究講座も設立する。',
            'トヨタ自動車とNTTは12日、自動運転技術の開発加速に向けた資本業務提携を発表した。NTTがトヨタに2,000億円出資し、両社の持ち株比率を調整する。共同開発する技術は5G/6G通信を活用したV2X（車両間通信）システムで、2026年の実用化を目指す。トヨタの豊田章男会長は「通信技術との融合で完全自動運転を実現する」と述べた。また、両社は自動運転車向けサイバーセキュリティ技術の開発でも協力し、国際標準化を推進する。',
            '経済産業省は11日、半導体戦略の一環として台湾TSMC熊本工場への追加支援3,000億円の予算計上を発表した。これまでの支援総額は8,000億円となり、国内半導体生産能力の向上を図る。萩生田光一経産相は「経済安全保障の観点から極めて重要」と強調した。TSMCは第2工場の建設も検討しており、総投資額は2兆円規模に達する見込み。また、ソニーやデンソーなど国内企業との連携強化により、車載半導体の国産化も推進する。'
        ]
    };

    return Array.from({length: query.limit}, (_, i) => ({
        title_ja: titles[i % titles.length],
        url: null, // フォールバックニュースはURLなし
        published_at: new Date(Date.now() - i * 3600000).toISOString(),
        summary_ja: `${titles[i % titles.length]}に関する詳細な最新情報。政府関係者や企業幹部の発言、具体的な数値データ、今後の展望について包括的に報道。`,
        content_ja: detailedContent[query.category]?.[i % detailedContent[query.category].length] || `これは${query.category}カテゴリーの詳細なニュース記事です。具体的な数値、関係者の発言、背景情報を含む包括的な内容となっています。`,
        source: null, // フォールバックニュースはソースなし
        category: query.category,
        id: generateArticleId(`https://example-news.com/${query.category}/${Date.now()}-${i}`, titles[i % titles.length]),
        fetched_at: new Date().toISOString(),
        isFallback: true // フォールバックフラグ
    }));
}

function generateFallbackProcessedContent(article, config) {
    console.log(`⚠️ フォールバック記事コンテンツ生成中: "${article.title_ja}" (${config.cefr}レベル)`);
    
    const complexityMap = {
        simple: 'easy to understand',
        moderate: 'moderately complex', 
        advanced: 'sophisticated'
    };
    
    return {
        en_title: `${article.title_ja.substring(0, 50)} (English Version)`,
        en_body: `This ${complexityMap[config.complexity]} article discusses important developments in ${article.category}. The content has been carefully adapted for ${config.cefr} level English learners. It covers the main points from the original Japanese article while using appropriate vocabulary and sentence structures for this learning level. The information presented helps readers understand current trends and significant events.`,
        ja_translation: `この記事は${article.category}分野の重要な発展について、${config.cefr}レベルの英語学習者向けに適応された内容です。元の日本語記事の要点を適切な語彙と文構造で説明しています。`,
        vocab_glossary: [
            {
                headword: "development",
                meaning_ja: "発展、進歩"
            },
            {
                headword: "article", 
                meaning_ja: "記事"
            },
            {
                headword: "important",
                meaning_ja: "重要な"
            }
        ],
        grammar_notes: [
            {
                title: "Present Perfect Tense",
                explanation_ja: "現在完了形は過去の行動が現在に影響を与える時に使います。",
                example_en: "The technology has improved significantly."
            },
            {
                title: "Passive Voice", 
                explanation_ja: "受動態は動作の受け手を強調する時に使います。",
                example_en: "The article was written by an expert."
            }
        ],
        isFallback: true // フォールバックフラグを継承
    };
}

// 個別記事の詳細処理エンドポイント
router.post('/process-article', async (req, res) => {
    try {
        const { article, level } = req.body;
        
        if (!article || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'article and level are required'
            });
        }

        console.log(`📝 個別記事処理開始: "${article.title_ja}"`);
        
        // 完全な記事処理を実行
        const processedArticle = await processArticleContent(article, level);
        
        // TTS音声生成
        if (processedArticle.en_body) {
            console.log(`🎵 TTS音声生成開始...`);
            processedArticle.audioUrl = await generateTTS(processedArticle.en_body, level);
        }
        
        console.log(`✅ 個別記事処理完了: "${processedArticle.en_title}"`);
        
        res.json({
            success: true,
            article: processedArticle,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Individual article processing error:', error);
        res.status(500).json({
            error: 'Processing Failed',
            message: 'Failed to process individual article'
        });
    }
});


// 和訳生成エンドポイント
router.post('/generate-translation', async (req, res) => {
    try {
        const { en_body, level } = req.body;
        
        if (!en_body || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'en_body and level are required'
            });
        }

        console.log(`📝 和訳生成開始: レベル ${level}`);
        
        const config = LEVEL_CONFIG[level];
        
        const prompt = `以下の英語ニュース記事を、日本のニュースサイトで読むような自然で読みやすい日本語に翻訳してください。

英語記事:
"${en_body}"

翻訳要件:
- 日本人が読んで違和感のない、完全に自然な日本語にする
- 直訳ではなく、日本語として最も適切で読みやすい表現を選ぶ
- ニュース記事として自然な文体（丁寧語中心、必要に応じて敬語）
- 固有名詞は日本で一般的な表記に統一（例：ビリー・アイリッシュ、サクラメント等）
- 文章の流れを重視し、日本語として読みやすい構成にする
- 冗長な表現を避け、簡潔で分かりやすい文章にする
- ${config.cefr}レベルの学習者でも理解しやすい語彙と構文を使用

重要: 機械翻訳的ではなく、日本人記者が書いたような自然な日本語記事にしてください。

JSONフォーマットで返答:
{
  "ja_translation": "完全に自然な日本語翻訳"
}`;

        const response = await openaiClient.post('/chat/completions', {
            model: process.env.GPT_MODEL || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'あなたは日本の一流新聞社で働く熟練の翻訳者です。英語記事を、日本人読者が読んで全く違和感のない、完全に自然な日本語記事に翻訳してください。直訳ではなく、日本語として最も自然で読みやすい表現を選択し、日本人記者が書いたような文章にしてください。有効なJSONフォーマットで返答してください。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7, // より自然で多様な表現のために温度を上げる
            max_tokens: 1500
        });

        const content = response.data.choices[0].message.content.trim();
        let translationData;
        
        try {
            const jsonMatch = content.match(/\{.*?\}/s);
            if (jsonMatch) {
                translationData = JSON.parse(jsonMatch[0]);
            } else {
                translationData = JSON.parse(content);
            }
        } catch (parseError) {
            console.log(`❌ JSONパースエラー:`, parseError.message);
            translationData = { ja_translation: "翻訳に失敗しました。" };
        }

        console.log(`✅ 和訳生成完了`);
        
        res.json({
            success: true,
            ja_translation: translationData.ja_translation,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Translation generation error:', error);
        res.status(500).json({
            error: 'Translation Failed',
            message: 'Failed to generate translation'
        });
    }
});

// 音声付き和訳生成エンドポイント
router.post('/generate-audio-translation', async (req, res) => {
    try {
        const { en_body, level } = req.body;
        
        if (!en_body || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'en_body and level are required'
            });
        }

        console.log(`🎵 音声付き和訳生成開始: レベル ${level}`);
        
        // 複数の音声を生成
        const voiceOptions = {};
        const voices = ['alloy', 'fable']; // US Male, UK Male
        
        for (const voice of voices) {
            try {
                const audioUrl = await generateTTS(en_body, level, voice);
                if (audioUrl) {
                    voiceOptions[voice] = audioUrl;
                }
            } catch (error) {
                console.log(`⚠️ ${voice} 音声生成失敗: ${error.message}`);
            }
        }
        
        console.log(`✅ 音声付き和訳生成完了: ${Object.keys(voiceOptions).length}個の音声`);
        
        res.json({
            success: true,
            voiceOptions: voiceOptions,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Audio translation generation error:', error);
        res.status(500).json({
            error: 'Audio Translation Failed',
            message: 'Failed to generate audio translation'
        });
    }
});

// TTS音声生成関数（音声タイプ対応）
async function generateTTS(text, level, voice = 'alloy') {
    try {
        const baseURL = process.env.BASE_URL || 'http://localhost:3000';
        const response = await fetch(`${baseURL}/api/tts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                level: level,
                voice: voice
            })
        });
        
        if (!response.ok) {
            throw new Error(`TTS API error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.success ? data.audioUrl : null;
        
    } catch (error) {
        console.error('TTS生成エラー:', error);
        return null;
    }
}

module.exports = router;