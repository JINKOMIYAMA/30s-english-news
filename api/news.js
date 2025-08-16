const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cheerio = require('cheerio');
const router = express.Router();

// 過去のニュースタイトル記録（過去2回分 = 10記事分）
const recentNewsHistory = new Map(); // key: "level_category", value: Array of normalized titles

// タイトル正規化関数（強化版）
function normalizeTitle(title) {
    return title
        .replace(/\s+/g, '')
        .replace(/[!?.,。、！？\-\(\)\[\]]/g, '')
        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .toLowerCase();
}

// タイトル類似度計算（コサイン類似度ベース）
function calculateTitleSimilarity(title1, title2) {
    const normalize = (text) => text
        .replace(/[!?.,。、！？\-\(\)\[\]]/g, '')
        .toLowerCase()
        .split('')
        .filter(char => char.trim());
    
    const chars1 = normalize(title1);
    const chars2 = normalize(title2);
    
    if (chars1.length === 0 || chars2.length === 0) return 0;
    
    // 文字の出現頻度を計算
    const charFreq1 = {};
    const charFreq2 = {};
    
    chars1.forEach(char => charFreq1[char] = (charFreq1[char] || 0) + 1);
    chars2.forEach(char => charFreq2[char] = (charFreq2[char] || 0) + 1);
    
    // 共通文字セット
    const allChars = new Set([...Object.keys(charFreq1), ...Object.keys(charFreq2)]);
    
    // ベクトルの内積と大きさを計算
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;
    
    allChars.forEach(char => {
        const freq1 = charFreq1[char] || 0;
        const freq2 = charFreq2[char] || 0;
        dotProduct += freq1 * freq2;
        magnitude1 += freq1 * freq1;
        magnitude2 += freq2 * freq2;
    });
    
    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
}

// 重要キーワード抽出（日本語記事用）
function extractKeywords(text) {
    // よくある接続詞や助詞を除外
    const stopWords = ['の', 'に', 'は', 'を', 'が', 'で', 'と', 'から', 'まで', 'より', 'へ', 'や', 'か', 'も', 'こと', 'これ', 'それ', 'あれ', 'この', 'その', 'あの'];
    
    const words = text
        .replace(/[!?.,。、！？\-\(\)\[\]]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 2 && !stopWords.includes(word))
        .map(word => word.toLowerCase());
    
    return [...new Set(words)]; // 重複除去
}

// 過去のニュースと重複チェック（ローテーション機能付き）
function filterDuplicateNews(articles, level, categories) {
    const historyKey = `${level}_${categories.join('_')}`;
    const previousData = recentNewsHistory.get(historyKey) || [];
    
    // 現在使用中の記事（最新5件）を特定
    const currentlyUsedArticles = previousData.slice(-5);
    
    console.log(`📋 履歴状況: 総${previousData.length}件、現在使用中${currentlyUsedArticles.length}件`);
    
    // まず、現在使用中の記事との重複をチェック
    const filteredArticles = articles.filter(article => {
        const currentTitle = article.title_ja;
        const currentKeywords = extractKeywords(currentTitle + ' ' + (article.content_ja || ''));
        
        // 現在使用中の記事との類似度チェック
        for (const usedData of currentlyUsedArticles) {
            const similarity = calculateTitleSimilarity(currentTitle, usedData.title);
            
            // 使用中記事との類似度が70%以上の場合は除外
            if (similarity > 0.7) {
                console.log(`🔍 使用中記事と類似: "${currentTitle}" ≈ "${usedData.title}" (類似度: ${(similarity * 100).toFixed(1)}%)`);
                return false;
            }
            
            // 主要人名・固有名詞の重複チェック
            const celebrityNames = ['森咲智美', '佐藤健', '菅田将暉', '滝川クリステル', '小泉進次郎'];
            const currentCelebrities = celebrityNames.filter(name => currentTitle.includes(name));
            const usedCelebrities = celebrityNames.filter(name => usedData.title.includes(name));
            
            if (currentCelebrities.length > 0 && usedCelebrities.length > 0) {
                const sharedCelebrities = currentCelebrities.filter(name => usedCelebrities.includes(name));
                if (sharedCelebrities.length > 0) {
                    console.log(`🔍 使用中記事と同一人物: "${currentTitle}" (共通人物: ${sharedCelebrities.join(', ')})`);
                    return false;
                }
            }
            
            // キーワードベースの重複チェック
            if (usedData.keywords) {
                const commonKeywords = currentKeywords.filter(keyword => 
                    usedData.keywords.includes(keyword) && keyword.length > 1
                );
                const keywordSimilarity = commonKeywords.length / Math.max(currentKeywords.length, usedData.keywords.length, 1);
                
                if (keywordSimilarity > 0.5 && commonKeywords.length >= 3) {
                    console.log(`🔍 使用中記事と類似内容: "${currentTitle}" (共通キーワード: ${commonKeywords.length})`);
                    return false;
                }
            }
        }
        
        return true;
    });
    
    console.log(`📋 重複チェック: ${articles.length}件 → ${filteredArticles.length}件（現在使用中${currentlyUsedArticles.length}件と比較）`);
    
    // 新しい記事が不足している場合、過去の記事（使用中以外）からローテーション
    if (filteredArticles.length < 5 && previousData.length > 5) {
        const unusedArticles = previousData.slice(0, -5); // 使用中以外の過去記事
        const neededCount = 5 - filteredArticles.length;
        
        console.log(`🔄 記事不足（${filteredArticles.length}件）。過去記事${unusedArticles.length}件からローテーション取得: ${neededCount}件`);
        
        // 過去記事を新しい記事として再利用（最大必要数まで）
        const rotatedArticles = unusedArticles.slice(-neededCount).map(historyItem => ({
            title_ja: historyItem.title,
            url: `#rotated-${Date.now()}-${Math.random()}`, // 一意なURL生成
            published_at: new Date().toISOString(), // 新しいタイムスタンプ
            summary_ja: `【再掲載】${historyItem.title}`,
            content_ja: historyItem.title,
            source: 'ローテーション',
            category: categories[0],
            image_url: null,
            isRotated: true // ローテーション記事フラグ
        }));
        
        filteredArticles.push(...rotatedArticles);
        console.log(`✅ ローテーション記事追加: ${rotatedArticles.length}件（合計${filteredArticles.length}件）`);
    }
    
    return filteredArticles;
}

// 現在のニュースタイトルを履歴に追加（強化版：キーワードも保存）
function addToNewsHistory(articles, level, categories) {
    const historyKey = `${level}_${categories.join('_')}`;
    const currentData = articles.map(article => ({
        title: article.title_ja,
        normalizedTitle: normalizeTitle(article.title_ja),
        keywords: extractKeywords(article.title_ja + ' ' + (article.content_ja || '')),
        addedAt: new Date().toISOString()
    }));
    
    let history = recentNewsHistory.get(historyKey) || [];
    
    // 現在のデータを追加
    history.push(...currentData);
    
    // 過去2回分（15記事）のみ保持
    if (history.length > 15) {
        history = history.slice(-15);
    }
    
    recentNewsHistory.set(historyKey, history);
    console.log(`📚 強化履歴更新: ${historyKey} に${currentData.length}件追加（総計${history.length}件、キーワード付き）`);
}

// NewsData.io カテゴリマッピング
const NEWSDATA_CATEGORIES = {
    lifestyle: "lifestyle",
    society: "politics", 
    economy: "business",
    entertainment: "entertainment",
    tech: "technology",
    all: "top" // すべてのカテゴリ
};

// レベル別設定
const LEVEL_CONFIG = {
    beginner: { wordCount: 800, speed: 0.9, cefr: "A2", complexity: "simple" },
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
    timeout: 60000 // 60秒に延長（GPT-5安定性向上）
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
        
        // 各カテゴリでニュースを順次検索（レート制限対策）
        console.log(`⚡ ${searchQueries.length}カテゴリを順次処理で検索開始...`);
        const allArticlesArrays = [];
        
        for (const query of searchQueries) {
            try {
                console.log(`🔍 カテゴリ ${query.category} を処理中...`);
                const articles = await searchNewsWithNewsData(query);
                allArticlesArrays.push(articles);
                
                // レート制限対策: 各リクエスト間に2秒待機
                if (searchQueries.length > 1) {
                    console.log(`⏱️ レート制限対策で2秒待機...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error(`カテゴリ ${query.category} 検索失敗:`, error.message);
                allArticlesArrays.push([]); // エラー時は空配列
            }
        }
        
        const allArticles = allArticlesArrays.flat();
        
        // 既存の重複排除
        const uniqueArticles = removeDuplicateArticles(allArticles);
        
        // 過去のニュースとの重複チェック
        const filteredArticles = filterDuplicateNews(uniqueArticles, level, categories);
        
        // 重複排除後に5件確保できない場合の処理
        let selectedArticles = filteredArticles.slice(0, process.env.MAX_ARTICLES || 5);
        
        // 5件に満たない場合は、段階的に制限を緩くする
        if (selectedArticles.length < 5) {
            console.log(`⚠️ 重複排除後の記事が不足（${selectedArticles.length}件）。制限を緩和して追加取得...`);
            
            // 元の記事から追加で取得（ただし完全重複は避ける）
            const additionalArticles = uniqueArticles
                .filter(article => !selectedArticles.some(selected => selected.url === article.url))
                .slice(0, 5 - selectedArticles.length);
            
            selectedArticles = [...selectedArticles, ...additionalArticles];
            console.log(`✅ 制限緩和により合計${selectedArticles.length}件を確保`);
        }
        
        // 実際のニュースが取得できない場合はエラーを返す
        if (selectedArticles.length === 0) {
            console.error(`❌ 実際のニュースを取得できませんでした。架空ニュースは生成しません。`);
            return res.status(503).json({
                error: 'No Real News Available',
                message: '現在、実際のニュースを取得できません。しばらく時間をおいてから再試行してください。',
                timestamp: new Date().toISOString()
            });
        }
        
        // 記事内容の完全処理（英語本文と解説を含む）
        console.log(`📝 ${selectedArticles.length}件の記事を完全処理中...`);
        
        const processPromises = selectedArticles.map(article => 
            processArticleContent(article, level).catch(error => {
                console.error(`記事処理失敗: ${article.title_ja}`, error.message);
                // 処理失敗時も基本情報は保持（日本語タイトル表示のため）
                return {
                    ...article,
                    en_title: article.title_ja, // 英語タイトルが生成できない場合
                    en_body: `この記事の英語版生成に失敗しました。元のタイトル: ${article.title_ja}`,
                    vocab_glossary: [],
                    grammar_notes: [],
                    level: level,
                    processing_failed: true
                };
            })
        );
        
        const processedArticles = await Promise.all(processPromises);
        
        // 全ての記事を含める（処理失敗しても日本語タイトルは表示可能）
        const lightweightArticles = processedArticles.filter(article => article !== null);
        
        console.log(`✅ Found ${lightweightArticles.length} articles`);
        
        // 成功時に履歴を更新
        addToNewsHistory(selectedArticles, level, categories);
        
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
        Object.keys(NEWSDATA_CATEGORIES).forEach(category => {
            if (category !== 'all') {
                queries.push({
                    category: category,
                    date: today,
                    level: level,
                    limit: 4  // より多くのニュースを要求
                });
            }
        });
    } else {
        // 選択されたカテゴリーのみの場合でも、関連カテゴリーを追加して多様性を向上
        const primaryCategory = categories[0];
        queries.push({
            category: primaryCategory,
            date: today,
            level: level,
            limit: 8  // メインカテゴリーから多く取得
        });
        
        // 多様性のために他のカテゴリーも少しずつ追加
        const relatedCategories = ['society', 'tech', 'economy'].filter(cat => cat !== primaryCategory);
        relatedCategories.forEach(category => {
            queries.push({
                category: category,
                date: today,
                level: level,
                limit: 2  // 関連カテゴリーから少し取得
            });
        });
    }
    
    return queries;
}

// リアルタイムニュース検索（Web検索統合）
// NewsData.io APIを使用したニュース検索
async function searchNewsWithNewsData(query) {
    console.log(`🔍 NewsData.ioニュース検索開始 - カテゴリ: ${query.category}`);
    
    try {
        // NewsData.io APIから直接ニュースを取得
        const articles = await fetchRealNewsWithNewsData(query);
        
        // 記事にIDと取得時刻を追加
        return articles.map(article => ({
            ...article,
            id: generateArticleId(article.url, article.title_ja),
            fetched_at: new Date().toISOString()
        }));
        
    } catch (error) {
        console.error('NewsData.io検索エラー:', error.message);
        throw error;
    }
}

// 軽量記事処理（タイトルのみ英語化）
async function processArticleTitle(article, level) {
    console.log(`🏃‍♂️ 軽量処理: "${article.title_ja}"`);
    
    const config = LEVEL_CONFIG[level];
    
    const prompt = `この日本語ニュースタイトルを${config.cefr}レベルの学習者向けに英語に翻訳してください：
"${article.title_ja}"

シンプルなJSONオブジェクトのみを返してください：
{
  "en_title": "英語タイトル（最大80文字、${config.cefr}語彙）"
}`;

    try {
        console.log(`🤖 タイトル翻訳API呼び出し中...`);
        
        const response = await openaiClient.post('/responses', {
            model: 'gpt-5',
            input: `あなたはタイトル翻訳者です。有効なJSONのみを返してください。\n\n${prompt}`,
            reasoning: { effort: "minimal" },
            text: { verbosity: "low" }
        });

        console.log(`✅ タイトル翻訳完了`);
        
        // GPT-5 Responses API structure
        const messageOutput = response.data.output?.find(item => item.type === 'message');
        const textContent = messageOutput?.content?.find(item => item.type === 'output_text');
        const content = (textContent?.text || '').trim();
        
        let titleData;
        try {
            const jsonMatch = content.match(/\{.*?\}/s);
            if (jsonMatch) {
                titleData = JSON.parse(jsonMatch[0]);
            } else {
                titleData = JSON.parse(content);
            }
        } catch (parseError) {
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
        console.error('タイトル処理エラー:', error.message);
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
    // レベル別の語数範囲を明確に設定
    let wordCountMin, wordCountMax;
    if (level === 'beginner') {
        wordCountMin = 120;  // 120語
        wordCountMax = 200;  // 200語
    } else if (level === 'intermediate') {
        wordCountMin = 200;  // 200語
        wordCountMax = 300;  // 300語
    } else { // advanced
        wordCountMin = 300;  // 300語
        wordCountMax = 400;  // 400語
    }
    
    const prompt = `あなたは日本人学習者向けの英語学習コンテンツ生成者です。
この日本語ニュース記事を、${config.cefr}レベルの学習者向けの英語コンテンツに変換してください。

元記事：
タイトル: ${article.title_ja}
内容: ${article.content_ja}
情報源: ${article.source}
カテゴリ: ${article.category}

${config.complexity}の言語複雑度で学習コンテンツを作成してください。

この構造のJSONのみを返してください：
{
  "en_title": "英語タイトル（最大80文字）",
  "en_body": "英語記事本文（必ず${wordCountMin}-${wordCountMax}語以内、${config.cefr}レベルに適した${config.complexity}な語彙と文構造を使用）",
  "ja_translation": "en_bodyの完全な日本語訳",
  "vocab_glossary": [
    {
      "headword": "単語",
      "pos": "品詞",
      "meaning_ja": "日本語の意味", 
      "example_en": "その単語を使った例文"
    }
  ],
  "grammar_notes": [
    {
      "title": "文法ポイントのタイトル",
      "explanation_ja": "文法ルールの日本語説明",
      "example_en": "英語の例文"
    }
  ]
}

要件：
- ${level === 'beginner' ? '6-8個' : '8-12個'}の${config.cefr}レベルに適した語彙項目を含める
- 記事で使用されている構造に焦点を当てた${level === 'beginner' ? '3-4個' : '3-5個'}の文法ポイントを含める
- 固有名詞（名前、場所）は正確に保つ
- ${config.cefr}レベルに適した語彙を使用
- 文章を${config.complexity}にしながらも明確にする
- en_bodyが自然に流れ、読んで興味深いものにする
- ${level === 'beginner' ? '文は短く、1文につき1つの主要なアイデアに集中する' : ''}
- **重要: en_bodyは必ず${wordCountMin}-${wordCountMax}語の範囲内に収める。語数を厳守すること。**`;

    try {
        console.log(`🤖 GPT-5記事整形API呼び出し中... (${config.cefr}レベル, ${wordCountMin}-${wordCountMax}語)`);
        
        const systemInstruction = `あなたは実際のニュース記事の英語学習コンテンツ作成専門家です。与えられた実際の日本語ニュースを${config.cefr}レベルの英語学習教材に変換してください。常に有効なJSONのみを返し、他のテキストは含めないでください。`;
        
        const response = await openaiClient.post('/responses', {
            model: 'gpt-5',
            input: `${systemInstruction}\n\n${prompt}`,
            reasoning: { effort: "minimal" },
            text: { verbosity: "low" }
        });

        console.log(`✅ GPT-5記事整形API応答受信`);
        
        // GPT-5 Responses API structure
        const messageOutput = response.data.output?.find(item => item.type === 'message');
        const textContent = messageOutput?.content?.find(item => item.type === 'output_text');
        const content = textContent?.text || '';
        
        console.log(`📄 記事整形コンテンツ長: ${content.length}文字`);
        
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
            console.warn(`❌ 記事整形JSON parse error: ${parseError.message}`);
            console.log(`📝 整形応答内容: ${content.substring(0, 200)}...`);
            throw new Error('記事整形JSON解析失敗');
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
        throw error; // エラーを上位に伝播
    }
}

// 重複排除（強化版：類似記事も検出）
function removeDuplicateArticles(articles) {
    const seen = new Set();
    const unique = [];
    
    for (const article of articles) {
        // URL正規化
        const normalizedUrl = normalizeUrl(article.url);
        const urlHash = hashString(normalizedUrl);
        
        if (seen.has(urlHash)) {
            continue; // URL重複はスキップ
        }
        
        // 既に追加された記事との類似度チェック
        let isDuplicate = false;
        const currentKeywords = extractKeywords(article.title_ja + ' ' + (article.content_ja || ''));
        
        for (const existingArticle of unique) {
            // タイトル類似度チェック（適度な厳格さ）
            const titleSimilarity = calculateTitleSimilarity(article.title_ja, existingArticle.title_ja);
            if (titleSimilarity > 0.85) { // 閾値をさらに緩和
                console.log(`🔍 同一リクエスト内類似記事除外: "${article.title_ja}" ≈ "${existingArticle.title_ja}" (類似度: ${(titleSimilarity * 100).toFixed(1)}%)`);
                isDuplicate = true;
                break;
            }
            
            // 主要人名の重複チェック（同一リクエスト内）
            const celebrityNames = ['森咲智美', '佐藤健', '菅田将暉', '滝川クリステル', '小泉進次郎', 'ウォズニアック', 'MacBook', 'Apple'];
            const currentCelebrities = celebrityNames.filter(name => article.title_ja.includes(name));
            const existingCelebrities = celebrityNames.filter(name => existingArticle.title_ja.includes(name));
            
            if (currentCelebrities.length > 0 && existingCelebrities.length > 0) {
                const sharedCelebrities = currentCelebrities.filter(name => existingCelebrities.includes(name));
                if (sharedCelebrities.length > 0) {
                    console.log(`🔍 同一リクエスト内同一人物除外: "${article.title_ja}" (共通: ${sharedCelebrities.join(', ')})`);
                    isDuplicate = true;
                    break;
                }
            }
            
            // キーワードベース類似度チェック（より厳格に）
            if (existingArticle._keywords) {
                const commonKeywords = currentKeywords.filter(keyword => 
                    existingArticle._keywords.includes(keyword) && keyword.length > 1
                );
                const keywordSimilarity = commonKeywords.length / Math.max(currentKeywords.length, existingArticle._keywords.length, 1);
                
                if (keywordSimilarity > 0.5 && commonKeywords.length >= 2) {
                    console.log(`🔍 同一リクエスト内類似内容除外: "${article.title_ja}" (共通キーワード: ${commonKeywords.length})`);
                    isDuplicate = true;
                    break;
                }
            }
        }
        
        if (!isDuplicate) {
            seen.add(urlHash);
            article._keywords = currentKeywords; // 一時的にキーワードを保存
            unique.push(article);
        }
    }
    
    // 一時的なキーワードプロパティを削除
    unique.forEach(article => delete article._keywords);
    
    console.log(`🎯 強化重複排除: ${articles.length}件 → ${unique.length}件（類似度・キーワードベース）`);
    
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

// 記事内容のみ処理（英語本文と解説のみ、高速）
router.post('/process-article-content', async (req, res) => {
    try {
        const { article, level } = req.body;
        
        if (!article || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'article and level are required'
            });
        }

        console.log(`📝 記事内容処理開始: "${article.title_ja}"`);
        
        // 記事内容のみ処理（音声生成はスキップ）
        const processedArticle = await processArticleContent(article, level);
        
        console.log(`✅ 記事内容処理完了: "${processedArticle.en_title}"`);
        
        res.json({
            success: true,
            article: processedArticle,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Article content processing error:', error);
        res.status(500).json({
            error: 'Processing Failed',
            message: 'Failed to process article content'
        });
    }
});

// 和訳専用生成エンドポイント
router.post('/generate-translation', async (req, res) => {
    try {
        const { en_body, level } = req.body;
        
        if (!en_body || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'en_body and level are required'
            });
        }

        console.log(`📝 自然な和訳生成開始... (${level}レベル)`);
        
        // 改善された日本語訳を生成
        const jaTranslation = await generateJapaneseTranslation(en_body);
        
        console.log(`✅ 自然な和訳生成完了`);
        
        res.json({
            success: true,
            ja_translation: jaTranslation,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Translation generation error:', error);
        res.status(500).json({
            error: 'Translation Failed',
            message: 'Failed to generate Japanese translation'
        });
    }
});

// 音声と日本語訳の追加処理（4種類の音声）
router.post('/generate-audio-translation', async (req, res) => {
    try {
        const { en_body, level } = req.body;
        
        if (!en_body || !level) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'en_body and level are required'
            });
        }

        console.log(`🎵 4種類の音声・翻訳生成開始...`);
        
        // 4種類のネイティブ音声を並列生成
        const voices = ['alloy', 'echo', 'fable', 'onyx']; // US Male, US Female, UK Male, UK Female
        const voiceLabels = ['US Male Native', 'US Female Native', 'UK Male Native', 'UK Female Native'];
        
        const [audioUrls, jaTranslation] = await Promise.all([
            Promise.all(voices.map(voice => generateTTSWithVoice(en_body, level, voice))),
            generateJapaneseTranslation(en_body)
        ]);
        
        // 音声URLと音声名をマッピング
        const voiceOptions = {};
        voices.forEach((voice, index) => {
            if (audioUrls[index]) {
                voiceOptions[voice] = {
                    url: audioUrls[index],
                    label: voiceLabels[index]
                };
            }
        });
        
        console.log(`✅ 4種類の音声・翻訳生成完了`);
        
        res.json({
            success: true,
            voiceOptions: voiceOptions,
            ja_translation: jaTranslation,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Audio/translation generation error:', error);
        res.status(500).json({
            error: 'Generation Failed',
            message: 'Failed to generate audio and translation'
        });
    }
});

// 個別記事の詳細処理エンドポイント（後方互換性のため残す）
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

// TTS音声生成関数
async function generateTTS(text, level) {
    try {
        const baseURL = process.env.BASE_URL || 'http://localhost:3000';
        const response = await fetch(`${baseURL}/api/tts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                level: level,
                voice: 'alloy'
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

// 特定の音声でTTS生成
async function generateTTSWithVoice(text, level, voice) {
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
        console.error(`TTS生成エラー (${voice}):`, error);
        return null;
    }
}

// 日本語訳生成（改善版：より自然な翻訳）
async function generateJapaneseTranslation(enBody) {
    try {
        const systemInstruction = `あなたは経験豊富な英日翻訳の専門家です。
英語学習者が理解しやすく、かつ自然で読みやすい日本語訳を作成してください。

翻訳における重要な方針：
1. 直訳ではなく、日本語として自然な表現を心がける
2. 固有名詞や専門用語は適切に日本語化する
3. 文章の流れを日本語の文章構造に合わせて調整する
4. 読み手が理解しやすい語順と表現を選択する
5. 敬語や丁寧語を適切に使用し、ニュース記事らしい文体を保つ
6. 原文の意味を正確に伝えながら、日本の読者に親しみやすい表現にする`;
        
        const prompt = `以下の英語ニュース記事を、日本のニュース記事として自然に読める日本語に翻訳してください。
直訳的な表現は避け、日本語として自然で流暢な文章に仕上げてください。

英語記事：
${enBody}

翻訳時の注意点：
- 英語の語順にとらわれず、日本語として読みやすい語順に調整
- 専門用語や固有名詞は日本で一般的に使われる表記を使用
- 文章の長さや区切りを日本語に適した形に調整
- ニュース記事らしい客観的で丁寧な文体を維持

日本語訳のみを出力してください。`;
        
        const response = await openaiClient.post('/responses', {
            model: 'gpt-5',
            input: `${systemInstruction}\n\n${prompt}`,
            reasoning: { effort: "high" }, // 翻訳品質向上のため reasoning effort を上げる
            text: { verbosity: "medium" } // より詳細な処理のため verbosity を上げる
        });

        // GPT-5 Responses API structure
        const messageOutput = response.data.output?.find(item => item.type === 'message');
        const textContent = messageOutput?.content?.find(item => item.type === 'output_text');
        const content = (textContent?.text || '翻訳に失敗しました。').trim();
        
        console.log(`✅ 改善された日本語訳生成完了: ${content.length}文字`);
        return content;
        
    } catch (error) {
        console.error('日本語訳生成エラー:', error);
        return 'より自然な翻訳の生成に失敗しました。お手数ですが、英語本文をご参照ください。';
    }
}

// RSS + NewsData.io 統合ニュース取得
async function fetchRealNewsWithNewsData(query) {
    try {
        console.log(`🔍 統合ニュース検索開始 - カテゴリ: ${query.category}`);
        
        // まずRSSから7日分のニュースを取得
        const rssArticles = await fetchNewsFromRSS(query);
        console.log(`📡 RSS取得: ${rssArticles.length}件`);
        
        // NewsData.ioからも最新ニュースを取得
        let newsdataArticles = [];
        try {
            newsdataArticles = await fetchFromNewsDataAPI(query);
            console.log(`📡 NewsData.io取得: ${newsdataArticles.length}件`);
        } catch (error) {
            console.warn('NewsData.io取得失敗、RSSのみ使用:', error.message);
        }
        
        // 結合して重複除去
        const allArticles = [...rssArticles, ...newsdataArticles];
        console.log(`📰 統合取得総数: ${allArticles.length}件`);
        
        return allArticles;
        
    } catch (error) {
        console.error('統合ニュース取得エラー:', error.message);
        throw error;
    }
}

// RSSからニュースを取得（7日分をカバー）
async function fetchNewsFromRSS(query) {
    const rssFeeds = getRSSFeedsByCategory(query.category);
    const articles = [];
    
    for (const feedUrl of rssFeeds) {
        try {
            console.log(`📡 RSS取得中: ${feedUrl}`);
            const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=10`;
            
            const response = await axios.get(rss2jsonUrl, { 
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            if (response.data.status === 'ok' && response.data.items) {
                const feedArticles = response.data.items
                    .filter(item => isRecentNews(item.pubDate)) // 7日以内のニュース
                    .map(item => ({
                        title_ja: item.title,
                        url: item.link || item.guid,
                        published_at: item.pubDate,
                        summary_ja: item.description || '',
                        content_ja: item.description || item.title,
                        source: extractSourceFromFeed(feedUrl),
                        category: query.category,
                        image_url: item.thumbnail || null
                    }));
                
                articles.push(...feedArticles);
                console.log(`✅ RSS追加: ${feedArticles.length}件`);
            }
        } catch (error) {
            console.warn(`RSS取得失敗 ${feedUrl}:`, error.message);
            if (error.response) {
                console.warn(`HTTPステータス: ${error.response.status}, データ: ${JSON.stringify(error.response.data).substring(0, 200)}`);
            }
        }
        
        // RSS取得間隔を空ける
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return articles;
}

// カテゴリ別RSS フィード取得
function getRSSFeedsByCategory(category) {
    const rssFeeds = {
        all: [
            'https://www3.nhk.or.jp/rss/news/cat0.xml', // NHK総合
            'https://news.yahoo.co.jp/rss/topics/top-picks.xml' // Yahoo主要
        ],
        society: [
            'https://www3.nhk.or.jp/rss/news/cat1.xml', // NHK社会
            'https://news.yahoo.co.jp/rss/categories/domestic.xml' // Yahoo国内
        ],
        entertainment: [
            'https://news.yahoo.co.jp/rss/categories/entertainment.xml', // Yahooエンタメ
            'https://www3.nhk.or.jp/rss/news/cat7.xml' // NHK文化・芸能
        ],
        tech: [
            'https://news.yahoo.co.jp/rss/categories/it.xml', // Yahoo IT
            'https://www3.nhk.or.jp/rss/news/cat5.xml' // NHK科学・文化
        ],
        economy: [
            'https://news.yahoo.co.jp/rss/categories/business.xml', // Yahoo経済
            'https://www3.nhk.or.jp/rss/news/cat4.xml' // NHK経済
        ],
        lifestyle: [
            'https://news.yahoo.co.jp/rss/categories/life.xml', // Yahooライフ
            'https://www3.nhk.or.jp/rss/news/cat0.xml' // NHK総合
        ]
    };
    
    return rssFeeds[category] || rssFeeds.all;
}

// ニュースの新しさチェック（7日以内）
function isRecentNews(pubDate) {
    try {
        const articleDate = new Date(pubDate);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        return articleDate >= sevenDaysAgo;
    } catch (error) {
        return true; // 日付解析失敗時は含める
    }
}

// RSSフィードからソース名を抽出
function extractSourceFromFeed(feedUrl) {
    if (feedUrl.includes('nhk.or.jp')) return 'NHK';
    if (feedUrl.includes('yahoo.co.jp')) return 'Yahoo News';
    return 'RSS Feed';
}

// NewsData.io APIからニュース取得（既存の実装）
async function fetchFromNewsDataAPI(query) {
    try {
        const category = NEWSDATA_CATEGORIES[query.category] || "top";
        const apiKey = process.env.NEWSDATA_API_KEY;
        
        if (!apiKey || apiKey === "your_newsdata_api_key_here") {
            throw new Error('NewsData.io APIキーが設定されていません');
        }
        
        console.log(`🔑 APIキー確認: ${apiKey.substring(0, 10)}...`);
        
        console.log(`📡 NewsData.io APIでニュース取得中... カテゴリ: ${category}`);
        
        const url = `${process.env.NEWSDATA_BASE_URL}/news`;
        // 日本国内ニュースに特化したパラメータ（安定性重視）
        const params = {
            apikey: apiKey,
            country: 'jp',
            language: 'ja',
            size: 10 // 無料プランの制限内で安定取得
        };
        
        // categoryパラメータは'top'以外の場合のみ追加（APIの制限対策）
        if (category !== 'top') {
            params.category = category;
        }
        
        console.log(`🔍 NewsData.io API Request: ${url}`, params);
        
        const response = await axios.get(url, {
            params: params,
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });
        
        console.log(`✅ NewsData.io API応答受信: ${response.data.results?.length || 0}件`);
        
        if (!response.data.results || response.data.results.length === 0) {
            throw new Error('NewsData.ioからニュースが取得できませんでした');
        }
        
        // 日本国内ニュースフィルタリング関数
        const isDomesticJapaneseNews = (item) => {
            const title = item.title || '';
            const description = item.description || '';
            const source = item.source_id || '';
            
            // 明らかに海外ニュースの除外キーワード
            const foreignKeywords = [
                'ドル', '株価', 'IPO', 'NASDAQ', 'NYSE', 'CEO', 'Inc.', 'Corp.',
                'ウォール街', 'S&P', 'ダウ', 'FTSE', '売却', '買収', '上場',
                'TruBridge', 'Regience', 'First Interstate', 'BancSystem'
            ];
            
            // 日本関連キーワード
            const japaneseKeywords = [
                '東京', '大阪', '名古屋', '福岡', '札幌', '仙台', '広島', '神戸',
                '日本', '政府', '首相', '大臣', '県', '市', '区', '町', '村',
                'NHK', 'テレビ朝日', 'TBS', 'フジテレビ', '読売', '朝日', '毎日',
                '警察', '消防', '病院', '学校', '大学', '会社', '企業'
            ];
            
            // 海外ニュースキーワードが含まれている場合は除外
            const hasForeignKeywords = foreignKeywords.some(keyword => 
                title.includes(keyword) || description.includes(keyword)
            );
            
            // 日本関連キーワードが含まれている場合は採用
            const hasJapaneseKeywords = japaneseKeywords.some(keyword => 
                title.includes(keyword) || description.includes(keyword)
            );
            
            // 日本のニュースソースかチェック
            const isJapaneseSource = source.includes('_jp') || 
                                   source.includes('nhk') || 
                                   source.includes('asahi') || 
                                   source.includes('mainichi') ||
                                   source.includes('yomiuri') ||
                                   source.includes('kyodo');
            
            // 判定: 海外キーワードがなく、かつ（日本キーワードがあるか日本ソース）
            return !hasForeignKeywords && (hasJapaneseKeywords || isJapaneseSource);
        };
        
        // NewsData.io形式を統一形式に変換（国内ニュースフィルタリング強化）
        const seenTitles = new Set();
        const articles = response.data.results
            .filter(item => {
                // 日本国内ニュースかチェック
                if (!isDomesticJapaneseNews(item)) {
                    console.log(`🚫 海外ニュース除外: "${item.title}"`);
                    return false;
                }
                
                // タイトルの重複チェック（簡易正規化）
                const normalizedTitle = item.title?.replace(/\s+/g, '').toLowerCase();
                if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
                    return false;
                }
                seenTitles.add(normalizedTitle);
                return true;
            })
            .slice(0, query.limit || 5) // 必要な件数だけに制限
            .map(item => ({
                title_ja: item.title,
                url: item.link || `https://newsdata.io/${item.article_id}`,
                published_at: item.pubDate || new Date().toISOString(),
                summary_ja: item.description || '',
                content_ja: item.description || item.title || '', // descriptionをcontentとして使用
                source: item.source_id || 'NewsData.io',
                category: query.category,
                image_url: item.image_url
            }));
        
        console.log(`🎯 ${articles.length}件のニュース記事を変換完了`);
        return articles;
        
    } catch (error) {
        console.error('NewsData.io API エラー:', error.message);
        throw error;
    }
}

// 重複履歴をリセット（管理用）
router.post('/reset-history', (req, res) => {
    try {
        const { level, categories } = req.body;
        
        if (level && categories) {
            // 特定のレベル・カテゴリの履歴をリセット
            const historyKey = `${level}_${categories.join('_')}`;
            recentNewsHistory.delete(historyKey);
            console.log(`📚 履歴リセット: ${historyKey}`);
        } else {
            // 全履歴をリセット
            recentNewsHistory.clear();
            console.log(`📚 全履歴リセット完了`);
        }
        
        res.json({
            success: true,
            message: 'News history reset successfully',
            remainingHistories: recentNewsHistory.size
        });
        
    } catch (error) {
        console.error('History reset error:', error);
        res.status(500).json({
            error: 'Reset Failed',
            message: 'Failed to reset news history'
        });
    }
});

module.exports = router;