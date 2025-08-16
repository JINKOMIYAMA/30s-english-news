// アプリの状態管理
const AppState = {
    selectedLevel: null,
    selectedCategories: []
};

// DOM要素の取得
const levelSelectScreen = document.getElementById('levelSelectScreen');
const categorySelectScreen = document.getElementById('categorySelectScreen');
const levelCards = document.querySelectorAll('.level-card');
const categoryCards = document.querySelectorAll('.category-card');
const nextButton = document.getElementById('nextButton');

// レベル選択のイベントリスナー
levelCards.forEach(card => {
    card.addEventListener('click', () => {
        // 他のカードの選択を解除
        levelCards.forEach(c => c.classList.remove('selected'));
        
        // 選択されたカードをハイライト
        card.classList.add('selected');
        
        // 状態を更新
        AppState.selectedLevel = card.dataset.level;
        
        // 選択効果音
        playSelectSound();
        
        // 少し遅延してから次の画面に遷移
        setTimeout(() => {
            showCategoryScreen();
        }, 300);
    });
});

// カテゴリー選択のイベントリスナー
categoryCards.forEach(card => {
    card.addEventListener('click', () => {
        const category = card.dataset.category;
        
        // "All Categories"が選択された場合
        if (category === 'all') {
            if (card.classList.contains('selected')) {
                // 既に選択されている場合は解除
                card.classList.remove('selected');
                AppState.selectedCategories = AppState.selectedCategories.filter(c => c !== 'all');
            } else {
                // 他のすべてのカテゴリーを解除してAll Categoriesのみ選択
                categoryCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                AppState.selectedCategories = ['all'];
            }
        } else {
            // 通常のカテゴリーが選択された場合
            if (card.classList.contains('selected')) {
                // 既に選択されている場合は解除
                card.classList.remove('selected');
                AppState.selectedCategories = AppState.selectedCategories.filter(c => c !== category);
            } else {
                // "All Categories"が選択されている場合は解除
                const allCategoryCard = document.querySelector('[data-category="all"]');
                if (allCategoryCard.classList.contains('selected')) {
                    allCategoryCard.classList.remove('selected');
                    AppState.selectedCategories = [];
                }
                
                // 新しいカテゴリーを追加
                card.classList.add('selected');
                AppState.selectedCategories.push(category);
            }
        }
        
        // 次へボタンの有効/無効を更新
        updateNextButton();
        
        // 選択効果音
        playSelectSound();
    });
});

// 次へボタンのイベントリスナー
nextButton.addEventListener('click', (event) => {
    event.preventDefault();
    
    if (AppState.selectedCategories.length > 0 && AppState.selectedLevel) {
        // 選択状態をローカルストレージに保存
        localStorage.setItem('selectedLevel', AppState.selectedLevel);
        localStorage.setItem('selectedCategories', JSON.stringify(AppState.selectedCategories));
        
        // 準備画面に遷移
        window.location.href = 'preparing.html';
    } else {
        alert('難易度とカテゴリーを選択してください。');
    }
});

// 画面遷移関数
function showCategoryScreen() {
    levelSelectScreen.classList.remove('active');
    categorySelectScreen.classList.add('active');
    
    // スライドイン効果
    categorySelectScreen.style.transform = 'translateX(100%)';
    categorySelectScreen.style.display = 'block';
    
    setTimeout(() => {
        categorySelectScreen.style.transform = 'translateX(0)';
        categorySelectScreen.style.transition = 'transform 0.5s ease-in-out';
        
        // 確実にカテゴリー画面の上部にスクロール
        setTimeout(() => {
            window.scrollTo({
                top: categorySelectScreen.offsetTop,
                behavior: 'smooth'
            });
        }, 200);
    }, 10);
}

// 次へボタンの状態更新
function updateNextButton() {
    if (AppState.selectedCategories.length > 0) {
        nextButton.disabled = false;
        nextButton.textContent = '次へ';
    } else {
        nextButton.disabled = true;
        nextButton.textContent = 'カテゴリーを選んでください';
    }
}


// 効果音再生関数
function playSelectSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
        // 音声エラーは無視
        console.log('Audio context error:', error);
    }
}

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('選択ページが読み込まれました');
    
    // 初期状態では次へボタンを無効化
    updateNextButton();
    
    // レベル選択画面を表示
    if (levelSelectScreen) {
        levelSelectScreen.classList.add('active');
    }
});

// キーボードナビゲーション
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const activeElement = document.activeElement;
        if (activeElement.classList.contains('level-card') || 
            activeElement.classList.contains('category-card')) {
            e.preventDefault();
            activeElement.click();
        }
    }
});

// レスポンシブデザインのための画面サイズ監視
window.addEventListener('resize', () => {
    if (window.innerWidth < 768) {
        document.body.classList.add('mobile');
    } else {
        document.body.classList.remove('mobile');
    }
});