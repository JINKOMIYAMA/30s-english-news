// アプリの状態管理
const AppState = {
    selectedLevel: null,
    selectedCategories: [],
    currentArticles: [],
    currentArticle: null,
    playbackSpeed: 1.0,
    isPlaying: false,
    currentAudio: null,
    currentVoice: 'alloy' // デフォルト音声
};

// カテゴリ別検索キーワードマッピング
const CATEGORY_KEYWORDS = {
    lifestyle: "local news, lifestyle, daily life Japan",
    society: "society, culture, community Japan",
    economy: "economy, business, finance Japan", 
    entertainment: "entertainment, celebrity, movies, music Japan",
    tech: "technology, innovation, gadgets, AI Japan",
    all: "Japan news latest"
};

// レベル別設定
const LEVEL_CONFIG = {
    beginner: { wordCount: 800, speed: 0.9, cefr: "A2", complexity: "simple" },
    intermediate: { wordCount: 3000, speed: 1.0, cefr: "B1", complexity: "moderate" },
    advanced: { wordCount: 5000, speed: 1.0, cefr: "C1", complexity: "advanced" }
};

// DOM要素の取得
const levelSelectScreen = document.getElementById('levelSelectScreen');
const categorySelectScreen = document.getElementById('categorySelectScreen');
const newsListScreen = document.getElementById('newsListScreen');
const articleDetailScreen = document.getElementById('articleDetailScreen');

// レベル選択のイベントリスナー
document.addEventListener('DOMContentLoaded', () => {
    console.log('アプリが初期化されました');
    
    // レベル選択画面を表示
    if (levelSelectScreen) {
        showScreen('levelSelectScreen');
        initializeLevelSelection();
    }
    
    // カテゴリー選択画面
    if (categorySelectScreen) {
        initializeCategorySelection();
    }
    
    // ニュース一覧画面
    if (newsListScreen) {
        initializeNewsList();
    }
    
    // 記事詳細画面
    if (articleDetailScreen) {
        initializeArticleDetail();
    }
});

// 画面切り替え
function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });
    
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
}

// レベル選択の初期化
function initializeLevelSelection() {
    const levelCards = document.querySelectorAll('.level-card');
    
    levelCards.forEach(card => {
        card.addEventListener('click', () => {
            levelCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            
            AppState.selectedLevel = card.dataset.level;
            console.log('選択されたレベル:', AppState.selectedLevel);
            
            // 少し遅延してからカテゴリー選択に移行
            setTimeout(() => {
                showScreen('categorySelectScreen');
            }, 300);
        });
    });
}

// カテゴリー選択の初期化
function initializeCategorySelection() {
    const categoryCards = document.querySelectorAll('.category-card');
    const nextButton = document.getElementById('nextButton');
    
    categoryCards.forEach(card => {
        card.addEventListener('click', () => {
            const category = card.dataset.category;
            
            if (category === 'all') {
                // All Categoriesが選択された場合
                if (card.classList.contains('selected')) {
                    card.classList.remove('selected');
                    AppState.selectedCategories = AppState.selectedCategories.filter(c => c !== 'all');
                } else {
                    categoryCards.forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    AppState.selectedCategories = ['all'];
                }
            } else {
                // 通常のカテゴリー
                if (card.classList.contains('selected')) {
                    card.classList.remove('selected');
                    AppState.selectedCategories = AppState.selectedCategories.filter(c => c !== category);
                } else {
                    // All Categoriesを解除
                    const allCard = document.querySelector('[data-category="all"]');
                    if (allCard.classList.contains('selected')) {
                        allCard.classList.remove('selected');
                        AppState.selectedCategories = [];
                    }
                    
                    card.classList.add('selected');
                    AppState.selectedCategories.push(category);
                }
            }
            
            updateNextButton();
        });
    });
    
    if (nextButton) {
        nextButton.addEventListener('click', (e) => {
            e.preventDefault();
            startNewsPreparation();
        });
    }
}

// 次へボタンの更新
function updateNextButton() {
    const nextButton = document.getElementById('nextButton');
    if (nextButton) {
        if (AppState.selectedCategories.length > 0) {
            nextButton.disabled = false;
            nextButton.textContent = 'ニュースを読む';
        } else {
            nextButton.disabled = true;
            nextButton.textContent = 'カテゴリーを選んでください';
        }
    }
}

// ニュース準備開始
function startNewsPreparation() {
    if (AppState.selectedCategories.length > 0 && AppState.selectedLevel) {
        localStorage.setItem('selectedLevel', AppState.selectedLevel);
        localStorage.setItem('selectedCategories', JSON.stringify(AppState.selectedCategories));
        
        window.location.href = 'preparing.html';
    } else {
        alert('レベルとカテゴリーを選択してください。');
    }
}

// ニュース一覧の初期化
function initializeNewsList() {
    // ローカルストレージからデータを取得
    const newsArticlesData = localStorage.getItem('newsArticles');
    const selectedLevel = localStorage.getItem('selectedLevel');
    
    if (!newsArticlesData || !selectedLevel) {
        alert('ニュースデータが見つかりません。');
        window.location.href = 'index.html';
        return;
    }
    
    try {
        AppState.currentArticles = JSON.parse(newsArticlesData);
        AppState.selectedLevel = selectedLevel;
        
        displayNewsList(AppState.currentArticles);
        updateCurrentLevelBadge();
        
    } catch (error) {
        console.error('ニュースデータ読み込みエラー:', error);
        alert('データの読み込みに失敗しました。');
        window.location.href = 'index.html';
    }
}

// ニュース一覧の表示
function displayNewsList(articles) {
    const newsGrid = document.getElementById('newsGrid');
    if (!newsGrid) return;
    
    newsGrid.innerHTML = '';
    
    if (articles.length === 0) {
        newsGrid.innerHTML = '<p style="text-align: center; color: #666;">ニュースがありません。</p>';
        return;
    }
    
    articles.forEach((article, index) => {
        const card = createNewsCard(article, index);
        newsGrid.appendChild(card);
    });
}

// ニュースカード作成
function createNewsCard(article, index) {
    const card = document.createElement('div');
    card.className = 'news-card simple-card';
    card.addEventListener('click', () => {
        localStorage.setItem('currentArticleIndex', index.toString());
        window.location.href = 'article.html';
    });
    
    const categoryLabels = {
        lifestyle: 'ライフスタイル',
        society: '社会',
        economy: '経済',
        entertainment: 'エンタメ',
        tech: 'テクノロジー'
    };
    
    card.innerHTML = `
        <div class="news-card-number">${index + 1}</div>
        <div class="news-card-simple-content">
            <div class="news-card-category">${categoryLabels[article.category] || article.category}</div>
            <h3 class="news-card-title">${article.title_ja}</h3>
        </div>
        <div class="news-card-arrow">→</div>
    `;
    
    return card;
}

// レベルバッジ更新
function updateCurrentLevelBadge() {
    const levelBadge = document.getElementById('currentLevel');
    if (levelBadge && AppState.selectedLevel) {
        const levelLabels = {
            beginner: '初心者',
            intermediate: '中級者',
            advanced: '上級者'
        };
        levelBadge.textContent = levelLabels[AppState.selectedLevel];
    }
}

// 記事詳細の初期化
function initializeArticleDetail() {
    // ローカルストレージからデータを取得
    const articleIndex = parseInt(localStorage.getItem('currentArticleIndex') || '0');
    const newsArticlesData = localStorage.getItem('newsArticles');
    
    if (!newsArticlesData) {
        alert('記事データが見つかりません。');
        window.location.href = 'news-list.html';
        return;
    }
    
    try {
        AppState.currentArticles = JSON.parse(newsArticlesData);
        AppState.currentArticle = AppState.currentArticles[articleIndex];
        
        if (!AppState.currentArticle) {
            throw new Error('指定された記事が見つかりません');
        }
        
        displayArticleDetail(AppState.currentArticle);
        
    } catch (error) {
        console.error('記事データ読み込みエラー:', error);
        alert('記事の読み込みに失敗しました。');
        window.location.href = 'news-list.html';
    }
}

// 記事詳細表示
function displayArticleDetail(article) {
    const articleContent = document.getElementById('articleContent');
    if (!articleContent) return;
    
    const publishedTime = new Date(article.published_at).toLocaleString('ja-JP');
    const categoryLabels = {
        lifestyle: 'ライフスタイル',
        society: '社会',
        economy: '経済',
        entertainment: 'エンタメ',
        tech: 'テクノロジー'
    };
    
    articleContent.innerHTML = `
        <div class="article-header">
            <h1 class="article-title">${article.en_title}</h1>
            <div class="article-meta-info">
                <span>📂 ${categoryLabels[article.category]}</span>
                <span>🕒 ${publishedTime}</span>
                <span>📖 ${Math.ceil(article.en_body?.split(' ').length / 200) || 1}分</span>
            </div>
        </div>
        <div class="article-body">
            <div class="english-text">${article.en_body}</div>
            
            <div class="japanese-translation">
                <h4>📝 日本語訳</h4>
                <div class="japanese-text">${article.ja_translation}</div>
            </div>
            
            <div class="vocabulary-section">
                <h4>📚 重要単語</h4>
                <div class="vocab-list">
                    ${article.vocab_glossary?.map(vocab => `
                        <div class="vocab-item">
                            <div class="vocab-word">${vocab.headword} <em>(${vocab.pos})</em></div>
                            <div class="vocab-meaning">${vocab.meaning_ja}</div>
                            <div class="vocab-example">${vocab.example_en}</div>
                        </div>
                    `).join('') || ''}
                </div>
            </div>
            
            <div class="grammar-section">
                <h4>📖 文法ポイント</h4>
                <div class="grammar-list">
                    ${article.grammar_notes?.map(grammar => `
                        <div class="grammar-item">
                            <div class="grammar-title">${grammar.title}</div>
                            <div class="grammar-explanation">${grammar.explanation_ja}</div>
                            <div class="grammar-example">${grammar.example_en}</div>
                        </div>
                    `).join('') || ''}
                </div>
            </div>
        </div>
    `;
}