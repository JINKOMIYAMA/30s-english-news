// アプリの状態管理
const PrepareState = {
    selectedLevel: null,
    selectedCategories: [],
    currentStep: 0,
    newsArticles: [],
    isProcessing: false
};

// 準備ステップ（高速化版：英語本文のみ先行取得）
const PREPARE_STEPS = [
    { icon: '🔍', text: '最新ニュースを検索中...', action: 'searchNews' },
    { icon: '📝', text: '英語記事を生成中...', action: 'processArticles' },
    { icon: '✅', text: '準備完了！', action: 'complete' }
];

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('準備画面が読み込まれました');
    
    // ローカルストレージから選択状態を取得
    PrepareState.selectedLevel = localStorage.getItem('selectedLevel');
    PrepareState.selectedCategories = JSON.parse(localStorage.getItem('selectedCategories') || '[]');
    
    if (!PrepareState.selectedLevel || PrepareState.selectedCategories.length === 0) {
        alert('選択情報が見つかりません。最初からやり直してください。');
        window.location.href = 'index.html';
        return;
    }
    
    console.log(`準備開始: レベル=${PrepareState.selectedLevel}, カテゴリ=${PrepareState.selectedCategories.join(', ')}`);
    
    // 処理開始
    startPreparation();
});

// 準備処理開始
async function startPreparation() {
    if (PrepareState.isProcessing) return;
    
    PrepareState.isProcessing = true;
    PrepareState.currentStep = 0;
    
    try {
        for (let i = 0; i < PREPARE_STEPS.length; i++) {
            PrepareState.currentStep = i;
            updateStepDisplay(i);
            
            const step = PREPARE_STEPS[i];
            
            switch (step.action) {
                case 'searchNews':
                    await searchNews();
                    break;
                case 'processArticles':
                    await processArticles();
                    break;
                case 'complete':
                    await completePreparation();
                    break;
            }
            
            // ステップ間の遅延
            await sleep(1000);
        }
        
        // 完了後、ニュース一覧画面に遷移
        setTimeout(() => {
            window.location.href = 'news-list.html';
        }, 1500);
        
    } catch (error) {
        console.error('準備処理エラー:', error);
        showErrorMessage('ニュースの準備中にエラーが発生しました。もう一度お試しください。');
        
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 3000);
    } finally {
        PrepareState.isProcessing = false;
    }
}

// ステップ表示の更新
function updateStepDisplay(currentStepIndex) {
    const steps = document.querySelectorAll('.step');
    
    steps.forEach((step, index) => {
        step.classList.remove('active', 'completed');
        
        if (index < currentStepIndex) {
            step.classList.add('completed');
        } else if (index === currentStepIndex) {
            step.classList.add('active');
        }
    });
}

// ニュース検索
async function searchNews() {
    console.log('🔍 ニュース検索開始...');
    
    const response = await fetch('/api/news/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            level: PrepareState.selectedLevel,
            categories: PrepareState.selectedCategories
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    PrepareState.newsArticles = data.articles || [];
    
    console.log(`✅ ${PrepareState.newsArticles.length}件のニュースを取得完了`);
}

// 記事処理（英語本文のみ生成、和訳・音声は後から）
async function processArticles() {
    console.log('📝 英語記事生成中...');
    
    // 英語本文の生成はAPI側で既に完了済み
    // 和訳と音声は個別記事選択時に生成
    await sleep(1500);
    
    console.log('✅ 英語記事生成完了（和訳・音声は記事選択時に生成）');
}

// TTS音声生成
async function generateTTS(text, level) {
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
}

// 準備完了（英語本文のみ保存）
async function completePreparation() {
    console.log('✅ 準備完了（高速化モード）');
    
    // 英語本文のみローカルストレージに保存
    // 和訳・音声データは含めない（個別生成）
    const articlesForStorage = PrepareState.newsArticles.map(article => ({
        ...article,
        ja_translation: null, // 和訳は個別生成
        audioUrl: null, // 音声は個別生成
        voiceOptions: null // 音声オプションも個別生成
    }));
    
    localStorage.setItem('newsArticles', JSON.stringify(articlesForStorage));
    localStorage.setItem('lastUpdated', new Date().toISOString());
    
    await sleep(800);
}

// エラーメッセージ表示
function showErrorMessage(message) {
    const messageElement = document.querySelector('.preparing-message');
    if (messageElement) {
        messageElement.innerHTML = `
            <p style="color: #e74c3c; font-weight: bold;">❌ ${message}</p>
            <p>自動的に選択画面に戻ります...</p>
        `;
    }
}

// スリープ関数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ページを離れる前の処理
window.addEventListener('beforeunload', () => {
    PrepareState.isProcessing = false;
});