// アプリの状態管理
const AppState = {
    currentArticles: [],
    selectedLevel: null
};

// DOM要素の取得
const currentLevelBadge = document.getElementById('currentLevel');
const loadingSpinner = document.getElementById('loadingSpinner');
const newsGrid = document.getElementById('newsGrid');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('ニュース一覧ページが読み込まれました');
    
    // ローカルストレージからデータを取得
    const selectedLevel = localStorage.getItem('selectedLevel');
    const newsArticlesData = localStorage.getItem('newsArticles');
    
    if (!selectedLevel || !newsArticlesData) {
        // データがない場合は選択ページに戻る
        alert('データが見つかりません。最初からやり直してください。');
        window.location.href = 'index.html';
        return;
    }
    
    try {
        AppState.currentArticles = JSON.parse(newsArticlesData);
        AppState.selectedLevel = selectedLevel;
        
        console.log('記事データ読み込み完了:', AppState.currentArticles.length + '件');
        
        // レベルバッジを更新
        updateLevelBadge();
        
        // ニュースカードを表示
        displayNewsCards(AppState.currentArticles);
        
    } catch (error) {
        console.error('データ読み込みエラー:', error);
        alert('データの読み込みに失敗しました。');
        window.location.href = 'index.html';
    }
});

// イベントリスナー設定
refreshBtn.addEventListener('click', () => {
    showRefreshConfirm();
});

settingsBtn.addEventListener('click', () => {
    // 設定画面（選択画面）に戻る
    if (confirm('設定を変更しますか？現在のニュースは削除されます。')) {
        localStorage.removeItem('newsArticles');
        localStorage.removeItem('selectedLevel');
        localStorage.removeItem('selectedCategories');
        window.location.href = 'index.html';
    }
});

// レベルバッジ更新
function updateLevelBadge() {
    const levelLabels = {
        beginner: 'Beginner',
        intermediate: 'Intermediate', 
        advanced: 'Advanced'
    };
    
    if (currentLevelBadge && AppState.selectedLevel) {
        currentLevelBadge.textContent = levelLabels[AppState.selectedLevel];
        console.log('レベルバッジ更新完了:', levelLabels[AppState.selectedLevel]);
    }
}

// ニュースカード表示
function displayNewsCards(articles) {
    newsGrid.innerHTML = '';
    
    if (articles.length === 0) {
        newsGrid.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">ニュースがありません。</p>';
        return;
    }
    
    articles.forEach((article, index) => {
        const card = createNewsCard(article, index);
        newsGrid.appendChild(card);
    });
    
    console.log(`${articles.length}個のニュースカードを表示しました`);
}

// ニュースカード作成（タイトルのみ表示）
function createNewsCard(article, index) {
    const card = document.createElement('div');
    card.className = 'news-card simple-card';
    card.addEventListener('click', () => {
        // 記事詳細ページに遷移
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

// ニュース更新確認ダイアログ
function showRefreshConfirm() {
    const modal = createConfirmModal();
    document.body.appendChild(modal);
    
    // アニメーション表示
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
}

// 確認モーダル作成
function createConfirmModal() {
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content">
            <div class="modal-icon">🔄</div>
            <h3 class="modal-title">ニュースを更新しますか？</h3>
            <p class="modal-message">現在のニュースが新しいものに置き換わります。<br>最新の情報を取得して学習コンテンツを再生成します。</p>
            <div class="modal-buttons">
                <button class="modal-btn cancel-btn" onclick="closeConfirmModal()">キャンセル</button>
                <button class="modal-btn confirm-btn" onclick="confirmRefresh()">はい、更新します</button>
            </div>
        </div>
    `;
    
    return modal;
}

// モーダルを閉じる
function closeConfirmModal() {
    const modal = document.querySelector('.confirm-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
        }, 300);
    }
}

// 更新確認
function confirmRefresh() {
    closeConfirmModal();
    
    // 準備画面に遷移
    showMessage('ニュースを更新します...', 'info');
    
    setTimeout(() => {
        window.location.href = 'preparing.html';
    }, 800);
}

// ニュース更新
async function refreshNews() {
    try {
        showLoading(true);
        
        // 選択情報を取得
        const selectedLevel = localStorage.getItem('selectedLevel');
        const selectedCategories = JSON.parse(localStorage.getItem('selectedCategories') || '[]');
        
        if (!selectedLevel || selectedCategories.length === 0) {
            throw new Error('選択情報が不足しています');
        }
        
        console.log('ニュース更新開始...');
        
        const response = await fetch('/api/news/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                level: selectedLevel,
                categories: selectedCategories
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const processedArticles = data.articles || [];
        
        // 音声生成
        for (let i = 0; i < processedArticles.length; i++) {
            const article = processedArticles[i];
            if (article.en_body) {
                console.log(`音声生成中... ${i + 1}/${processedArticles.length}`);
                article.audioUrl = await generateTTS(article.en_body, selectedLevel);
            }
        }
        
        // 新しいデータを保存
        AppState.currentArticles = processedArticles;
        localStorage.setItem('newsArticles', JSON.stringify(processedArticles));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        
        // 表示を更新
        displayNewsCards(processedArticles);
        
        showMessage('ニュースを更新しました！', 'success');
        
    } catch (error) {
        console.error('ニュース更新エラー:', error);
        showMessage('ニュースの更新に失敗しました。もう一度お試しください。', 'error');
    } finally {
        showLoading(false);
    }
}

// TTS音声生成
async function generateTTS(text, level) {
    try {
        const response = await fetch('/api/tts/generate', {
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

// ローディング表示制御
function showLoading(show) {
    if (loadingSpinner) {
        loadingSpinner.style.display = show ? 'block' : 'none';
        
        if (show) {
            startLoadingAnimation();
        } else {
            stopLoadingAnimation();
        }
    }
    
    if (refreshBtn) {
        refreshBtn.disabled = show;
        refreshBtn.textContent = show ? '⏳ 更新中...' : '🔄 新しいニュースを取得';
    }
}

// ローディングアニメーション制御
let loadingInterval;
const loadingMessages = [
    '最新ニュースを検索中...',
    'AIが記事を分析中...',
    '英語学習コンテンツを作成中...',
    'ニュースを更新中...'
];

function startLoadingAnimation() {
    const messageElement = document.querySelector('.loading-message');
    const progressBar = document.querySelector('.progress-bar');
    if (!messageElement) return;
    
    let messageIndex = 0;
    messageElement.textContent = loadingMessages[0];
    
    // プログレスバーのアニメーション速度を調整
    if (progressBar) {
        progressBar.style.animationDuration = '1.5s';
    }
    
    loadingInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % loadingMessages.length;
        
        // メッセージフェードアウト
        messageElement.style.opacity = '0.3';
        messageElement.style.transform = 'translateY(-5px)';
        
        setTimeout(() => {
            messageElement.textContent = loadingMessages[messageIndex];
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        }, 300);
    }, 2500);
}

function stopLoadingAnimation() {
    if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
    }
}

// メッセージ表示
function showMessage(message, type = 'info') {
    // トーストメッセージを作成
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // スタイルを設定
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        font-weight: bold;
        z-index: 10000;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    document.body.appendChild(toast);
    
    // アニメーション表示
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    // 自動削除
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        refreshNews();
    }
});