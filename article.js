// アプリの状態管理
const AppState = {
    currentArticle: null,
    currentArticleIndex: 0,
    allArticles: [],
    isPlaying: false,
    currentAudio: null,
    playbackSpeed: 1.0,
    selectedVoice: 'alloy', // US Male (default)
    voiceOptions: {
        'alloy': 'US Male',
        'fable': 'UK Male'
    }
};

// DOM要素の取得
const backBtn = document.getElementById('backBtn');
const playBtn = document.getElementById('playBtn');
const speedBtn = document.getElementById('speedBtn');
const voiceBtn = document.getElementById('voiceBtn');
const articleContent = document.getElementById('articleContent');

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('記事詳細ページが読み込まれました');
    
    // ローカルストレージからデータを取得
    const articleIndex = parseInt(localStorage.getItem('currentArticleIndex') || '0');
    const newsArticlesData = localStorage.getItem('newsArticles');
    
    if (!newsArticlesData) {
        alert('記事データが見つかりません。');
        window.location.href = 'news-list.html';
        return;
    }
    
    try {
        AppState.allArticles = JSON.parse(newsArticlesData);
        AppState.currentArticleIndex = articleIndex;
        AppState.currentArticle = AppState.allArticles[articleIndex];
        
        if (!AppState.currentArticle) {
            throw new Error('指定された記事が見つかりません');
        }
        
        console.log('記事データ読み込み完了:', AppState.currentArticle.en_title);
        
        // 音声ボタンを初期化
        updateVoiceButton();
        
        // 和訳・音声が未生成の場合は個別生成
        if (!AppState.currentArticle.ja_translation || !AppState.currentArticle.voiceOptions || !AppState.currentArticle.en_body) {
            console.log('和訳・音声未生成 - 個別生成を実行中...');
            // 個別生成を非同期で実行
            generateTranslationAndAudio(AppState.currentArticle);
        } else {
            // 既に処理済みの記事
            displayArticleContent(AppState.currentArticle);
        }
        
    } catch (error) {
        console.error('記事データ読み込みエラー:', error);
        alert('記事の読み込みに失敗しました。');
        window.location.href = 'news-list.html';
    }
});

// イベントリスナー設定
backBtn.addEventListener('click', () => {
    // 音声停止
    stopAudio();
    // ニュース一覧に戻る
    window.location.href = 'news-list.html';
});

playBtn.addEventListener('click', () => {
    toggleAudioPlayback();
});

speedBtn.addEventListener('click', () => {
    cyclePlaybackSpeed();
});

voiceBtn.addEventListener('click', () => {
    toggleVoiceSelection();
});

// 和訳・音声の個別生成
async function generateTranslationAndAudio(article) {
    try {
        // ローディング表示
        showLoadingTranslationAudio();
        
        const level = localStorage.getItem('selectedLevel');
        
        console.log('🔄 和訳・音声生成開始...');
        
        // en_bodyが存在しない場合は、まず記事の詳細処理を行う
        if (!article.en_body) {
            console.log('📝 en_body未生成 - 記事詳細処理を開始...');
            
            const processResponse = await fetch('/api/news/process-article', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    article: article,
                    level: level
                })
            });
            
            if (!processResponse.ok) {
                throw new Error('記事詳細処理エラー');
            }
            
            const processedData = await processResponse.json();
            if (processedData.success) {
                // 記事データを更新
                Object.assign(article, processedData.article);
                console.log('✅ 記事詳細処理完了');
            } else {
                throw new Error('記事詳細処理失敗');
            }
        }
        
        // en_bodyがまだない場合はエラー
        if (!article.en_body) {
            throw new Error('英語本文が生成されませんでした');
        }
        
        // まず英語記事を表示
        console.log('📄 英語記事を先に表示中...');
        displayEnglishContentFirst(AppState.currentArticle);
        
        // 和訳・音声を並列生成（バックグラウンド）
        const [translationResponse, audioResponse] = await Promise.all([
            fetch('/api/news/generate-translation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    en_body: article.en_body,
                    level: level
                })
            }),
            fetch('/api/news/generate-audio-translation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    en_body: article.en_body,
                    level: level
                })
            })
        ]);

        if (!translationResponse.ok || !audioResponse.ok) {
            throw new Error('生成API エラー');
        }

        const [translationData, audioData] = await Promise.all([
            translationResponse.json(),
            audioResponse.json()
        ]);
        
        // 記事データを更新
        AppState.currentArticle.ja_translation = translationData.ja_translation;
        AppState.currentArticle.voiceOptions = audioData.voiceOptions;
        
        // 配列とローカルストレージも更新
        AppState.allArticles[AppState.currentArticleIndex] = AppState.currentArticle;
        localStorage.setItem('newsArticles', JSON.stringify(AppState.allArticles));
        
        console.log('✅ 和訳・音声生成完了 - 日本語コンテンツを追加中...');
        
        // 和訳と音声を追加表示
        addJapaneseContent(AppState.currentArticle);
        
    } catch (error) {
        console.error('和訳・音声生成エラー:', error);
        showMessage('和訳・音声の生成に失敗しました。', 'error');
        // フォールバック: 英語本文のみ表示
        displayArticleContentBasic(article);
    }
}

// 和訳・音声生成のローディング表示
function showLoadingTranslationAudio() {
    articleContent.innerHTML = `
        <div class="article-header">
            <h1 class="article-title-ja">${AppState.currentArticle.title_ja}</h1>
            <h2 class="article-title-en">${AppState.currentArticle.en_title || '英語タイトル生成中...'}</h2>
        </div>
        <div class="article-body">
            <div style="text-align: center; padding: 3rem; background: #f8f9ff; border-radius: 12px; margin: 1rem 0;">
                <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #e3e3e3; border-top: 4px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <h3 style="margin-top: 1.5rem; color: #667eea;">AI が英語記事を生成中...</h3>
                <p style="color: #666; font-size: 1rem; margin: 0.5rem 0;">学習レベルに適した英語記事を作成しています</p>
                <div style="margin-top: 1rem; font-size: 0.9rem; color: #888;">
                    ✨ 英語記事 → 🇯🇵 日本語訳 → 🎵 音声の順で生成されます
                </div>
            </div>
        </div>
        <style>
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        </style>
    `;
}

// 基本表示（英語本文のみ）
function displayArticleContentBasic(article) {
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
            <h1 class="article-title-ja">${article.title_ja}</h1>
            <h2 class="article-title-en">${article.en_title}</h2>
            <div class="article-meta-info">
                <span>📂 ${categoryLabels[article.category]}</span>
                <span>🕒 ${publishedTime}</span>
                <span>📖 ${Math.ceil(article.en_body?.split(' ').length / 200) || 1}分</span>
                ${article.source && !article.isFallback ? `<span>📰 ${article.source}</span>` : ''}
            </div>
            ${article.url && !article.isFallback ? `
            <div class="article-source-info" style="margin-top: 1rem; padding: 0.75rem; background: #f5f7fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <div style="font-size: 0.9rem; color: #555;">
                    <strong>引用元:</strong> <a href="${article.url}" target="_blank" style="color: #3498db; text-decoration: none;">${article.source}</a>
                </div>
            </div>
            ` : ''}
        </div>
        <div class="article-body">
            <div class="english-text">${article.en_body}</div>
            
            <div style="text-align: center; padding: 2rem; background: #fff3cd; border-radius: 12px; margin: 1rem 0; border-left: 4px solid #ffc107;">
                <p style="color: #856404; margin: 0;">⚠️ 和訳と音声の生成に失敗しました。英語本文をお楽しみください。</p>
            </div>
        </div>
    `;
}

// 英語記事を先に表示
function displayEnglishContentFirst(article) {
    const publishedTime = new Date(article.published_at).toLocaleString('ja-JP');
    const categoryLabels = {
        lifestyle: 'ライフスタイル',
        society: '社会', 
        economy: '経済',
        entertainment: 'エンタメ',
        tech: 'テクノロジー'
    };
    
    // 重要単語を太文字にした英文を作成
    const highlightedEnglishText = highlightVocabularyInText(article.en_body, article.vocab_glossary);
    
    articleContent.innerHTML = `
        <div class="article-header">
            <h1 class="article-title-ja">${article.title_ja}</h1>
            <h2 class="article-title-en">${article.en_title}</h2>
            <div class="article-meta-info">
                <span>📂 ${categoryLabels[article.category]}</span>
                <span>🕒 ${publishedTime}</span>
                <span>📖 ${Math.ceil(article.en_body?.split(' ').length / 200) || 1}分</span>
                ${article.source && !article.isFallback ? `<span>📰 ${article.source}</span>` : ''}
            </div>
            ${article.url && !article.isFallback ? `
            <div class="article-source-info" style="margin-top: 1rem; padding: 0.75rem; background: #f5f7fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <div style="font-size: 0.9rem; color: #555;">
                    <strong>引用元:</strong> <a href="${article.url}" target="_blank" style="color: #3498db; text-decoration: none;">${article.source}</a>
                </div>
            </div>
            ` : ''}
        </div>
        <div class="article-body">
            <div class="english-text">${highlightedEnglishText}</div>
            
            <div id="japanese-content-placeholder" style="margin-top: 2rem;">
                <div style="text-align: center; padding: 2rem; background: #f8f9ff; border-radius: 12px; border-left: 4px solid #667eea;">
                    <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #e3e3e3; border-top: 3px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <h4 style="margin-top: 1rem; color: #667eea;">日本語訳と重要単語を生成中...</h4>
                    <p style="color: #666; font-size: 0.9rem;">まずは英語記事をお楽しみください</p>
                </div>
            </div>
            
            ${article.vocab_glossary ? `
            <div class="vocabulary-section">
                <h4>📚 重要単語</h4>
                <div class="vocab-list">
                    ${article.vocab_glossary?.map(vocab => `
                        <div class="vocab-item">
                            <div class="vocab-word">${vocab.headword}</div>
                            <div class="vocab-meaning">${vocab.meaning_ja}</div>
                        </div>
                    `).join('') || ''}
                </div>
            </div>
            ` : ''}
            
            ${article.grammar_notes ? `
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
            ` : ''}
        </div>
        <style>
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        </style>
    `;
}

// 日本語コンテンツを後から追加
function addJapaneseContent(article) {
    const placeholder = document.getElementById('japanese-content-placeholder');
    if (placeholder) {
        placeholder.innerHTML = `
            <div class="japanese-translation">
                <h4>📝 日本語訳</h4>
                <div class="japanese-text">${article.ja_translation}</div>
            </div>
        `;
        
        // アニメーション効果を追加
        placeholder.style.opacity = '0';
        placeholder.style.transform = 'translateY(20px)';
        placeholder.style.transition = 'all 0.5s ease';
        
        setTimeout(() => {
            placeholder.style.opacity = '1';
            placeholder.style.transform = 'translateY(0)';
        }, 100);
    }
}

// 記事詳細コンテンツ表示
function displayArticleContent(article) {
    const publishedTime = new Date(article.published_at).toLocaleString('ja-JP');
    const categoryLabels = {
        lifestyle: 'ライフスタイル',
        society: '社会', 
        economy: '経済',
        entertainment: 'エンタメ',
        tech: 'テクノロジー'
    };
    
    // 重要単語を太文字にした英文を作成
    const highlightedEnglishText = highlightVocabularyInText(article.en_body, article.vocab_glossary);
    
    articleContent.innerHTML = `
        <div class="article-header">
            <h1 class="article-title-ja">${article.title_ja}</h1>
            <h2 class="article-title-en">${article.en_title}</h2>
            <div class="article-meta-info">
                <span>📂 ${categoryLabels[article.category]}</span>
                <span>🕒 ${publishedTime}</span>
                <span>📖 ${Math.ceil(article.en_body?.split(' ').length / 200) || 1}分</span>
                ${article.source && !article.isFallback ? `<span>📰 ${article.source}</span>` : ''}
            </div>
            ${article.url && !article.isFallback ? `
            <div class="article-source-info" style="margin-top: 1rem; padding: 0.75rem; background: #f5f7fa; border-radius: 8px; border-left: 4px solid #3498db;">
                <div style="font-size: 0.9rem; color: #555;">
                    <strong>引用元:</strong> <a href="${article.url}" target="_blank" style="color: #3498db; text-decoration: none;">${article.source}</a>
                </div>
            </div>
            ` : ''}
        </div>
        <div class="article-body">
            <div class="english-text">${highlightedEnglishText}</div>
            
            <div class="japanese-translation">
                <h4>📝 日本語訳</h4>
                <div class="japanese-text">${article.ja_translation}</div>
            </div>
            
            <div class="vocabulary-section">
                <h4>📚 重要単語</h4>
                <div class="vocab-list">
                    ${article.vocab_glossary?.map(vocab => `
                        <div class="vocab-item">
                            <div class="vocab-word">${vocab.headword}</div>
                            <div class="vocab-meaning">${vocab.meaning_ja}</div>
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

// 音声再生制御
function toggleAudioPlayback() {
    if (AppState.isPlaying) {
        stopAudio();
    } else {
        playAudio();
    }
}

async function playAudio() {
    if (!AppState.currentArticle?.en_body) {
        showMessage('音声再生する記事がありません。', 'error');
        return;
    }

    try {
        // 選択された音声で音声ファイルを生成/取得
        const audioUrl = await generateAudioForVoice(AppState.currentArticle.en_body, AppState.selectedVoice);
        
        if (audioUrl) {
            // 実際のTTS音声ファイルを再生
            const audio = new Audio(audioUrl);
            audio.playbackRate = AppState.playbackSpeed;
            
            audio.play().then(() => {
                AppState.currentAudio = audio;
                AppState.isPlaying = true;
                playBtn.textContent = '⏸️ 停止';
                playBtn.classList.add('playing');
            }).catch((error) => {
                console.warn('Audio playback failed, using Web Speech API:', error);
                useWebSpeechAPI();
            });
            
            audio.onended = () => {
                AppState.isPlaying = false;
                playBtn.textContent = '🔊 音声再生';
                playBtn.classList.remove('playing');
            };
            
            audio.onerror = () => {
                console.warn('Audio file error, using Web Speech API');
                useWebSpeechAPI();
            };
        } else {
            // Web Speech API を使用（フォールバック）
            useWebSpeechAPI();
        }
    } catch (error) {
        console.error('Audio generation error:', error);
        useWebSpeechAPI();
    }
}

function useWebSpeechAPI() {
    if (!('speechSynthesis' in window)) {
        showMessage('お使いのブラウザは音声合成に対応していません。', 'error');
        return;
    }
    
    const utterance = new SpeechSynthesisUtterance(AppState.currentArticle.en_body);
    utterance.lang = 'en-US';
    utterance.rate = AppState.playbackSpeed;
    
    utterance.onstart = () => {
        AppState.isPlaying = true;
        playBtn.textContent = '⏸️ 停止';
        playBtn.classList.add('playing');
    };
    
    utterance.onend = () => {
        AppState.isPlaying = false;
        playBtn.textContent = '🔊 音声再生';
        playBtn.classList.remove('playing');
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        AppState.isPlaying = false;
        playBtn.textContent = '🔊 音声再生';
        playBtn.classList.remove('playing');
        
        if (event.error !== 'canceled') {
            showMessage('音声再生でエラーが発生しました。', 'error');
        }
    };
    
    speechSynthesis.speak(utterance);
    AppState.currentAudio = utterance;
}

function stopAudio() {
    if (AppState.currentAudio) {
        if (AppState.currentAudio instanceof SpeechSynthesisUtterance) {
            speechSynthesis.cancel();
        } else {
            AppState.currentAudio.pause();
            AppState.currentAudio.currentTime = 0;
        }
    }
    
    AppState.isPlaying = false;
    playBtn.textContent = '🔊 音声再生';
    playBtn.classList.remove('playing');
}

function cyclePlaybackSpeed() {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
    const currentIndex = speeds.indexOf(AppState.playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    AppState.playbackSpeed = speeds[nextIndex];
    speedBtn.textContent = `${AppState.playbackSpeed}x`;
    
    // 再生中の場合は速度を変更
    if (AppState.isPlaying && AppState.currentAudio) {
        if (AppState.currentAudio instanceof Audio) {
            AppState.currentAudio.playbackRate = AppState.playbackSpeed;
        } else {
            // Web Speech APIの場合は再開始が必要
            const wasPlaying = AppState.isPlaying;
            stopAudio();
            if (wasPlaying) {
                setTimeout(() => playAudio(), 100);
            }
        }
    }
}

// 音声選択の切り替え
function toggleVoiceSelection() {
    const voices = Object.keys(AppState.voiceOptions);
    const currentIndex = voices.indexOf(AppState.selectedVoice);
    const nextIndex = (currentIndex + 1) % voices.length;
    
    AppState.selectedVoice = voices[nextIndex];
    updateVoiceButton();
    
    console.log(`音声を切り替えました: ${AppState.voiceOptions[AppState.selectedVoice]}`);
    
    // 再生中の場合は新しい音声で再生し直す
    if (AppState.isPlaying) {
        stopAudio();
        setTimeout(() => playAudio(), 300);
    }
}

// 音声ボタンの表示更新
function updateVoiceButton() {
    if (voiceBtn) {
        voiceBtn.textContent = `🗣️ ${AppState.voiceOptions[AppState.selectedVoice]}`;
    }
}

// 指定された音声でTTS音声を生成/取得
async function generateAudioForVoice(text, voice) {
    try {
        const level = localStorage.getItem('selectedLevel') || 'intermediate';
        
        console.log(`🎵 TTS音声生成開始: ${voice} (${AppState.voiceOptions[voice]})`);
        
        const response = await fetch('/api/tts/generate', {
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
        
        if (data.success) {
            console.log(`✅ TTS音声生成完了: ${voice}`);
            return data.audioUrl;
        } else {
            throw new Error('TTS generation failed');
        }
        
    } catch (error) {
        console.error('TTS生成エラー:', error);
        return null;
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
    switch(e.code) {
        case 'Space':
            e.preventDefault();
            toggleAudioPlayback();
            break;
        case 'Escape':
            stopAudio();
            window.location.href = 'news-list.html';
            break;
    }
});

// ページを離れる前に音声を停止
window.addEventListener('beforeunload', () => {
    stopAudio();
});

// 重要単語を太文字にする関数
function highlightVocabularyInText(text, vocabulary) {
    if (!text || !vocabulary || vocabulary.length === 0) {
        return text;
    }
    
    let highlightedText = text;
    
    vocabulary.forEach(vocab => {
        if (vocab.headword) {
            // 単語境界を考慮した正規表現を作成
            const regex = new RegExp(`\\b(${vocab.headword})\\b`, 'gi');
            highlightedText = highlightedText.replace(regex, '<strong>$1</strong>');
        }
    });
    
    return highlightedText;
}