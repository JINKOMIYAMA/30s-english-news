// メイン画面のJavaScript - 自動でニュース準備に遷移
document.addEventListener('DOMContentLoaded', () => {
    console.log('30s English News - 自動でニュース準備開始');
    
    // 固定設定でローカルストレージに保存
    localStorage.setItem('selectedLevel', 'beginner');
    localStorage.setItem('selectedCategories', JSON.stringify(['entertainment', 'lifestyle']));
    
    // 準備画面に直接遷移
    window.location.href = 'preparing.html';
});

