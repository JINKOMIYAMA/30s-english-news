const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

// OpenAI TTS API設定
const openaiClient = axios.create({
    baseURL: process.env.OPENAI_BASE_URL,
    headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 120000 // 2分に延長
});

// 音声ファイル保存ディレクトリ
const AUDIO_DIR = path.join(__dirname, '../audio');
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// TTS音声生成エンドポイント
router.post('/generate', async (req, res) => {
    try {
        const { text, level, voice } = req.body;
        
        if (!text) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'text is required'
            });
        }

        // テキストの長さチェック（OpenAI TTS制限：4096文字）
        if (text.length > 4000) {
            return res.status(400).json({
                error: 'Text Too Long',
                message: 'Text must be under 4000 characters'
            });
        }

        console.log(`🎵 Generating TTS - Level: ${level}, Voice: ${voice}, Length: ${text.length} chars`);
        
        // ファイル名生成（ハッシュベース）
        const textHash = crypto.createHash('md5').update(text + (voice || 'alloy')).digest('hex');
        const audioFileName = `tts_${textHash}.mp3`;
        const audioFilePath = path.join(AUDIO_DIR, audioFileName);
        
        // 既存ファイルをチェック
        if (fs.existsSync(audioFilePath)) {
            console.log(`♻️ Using cached audio file: ${audioFileName}`);
            return res.json({
                success: true,
                audioUrl: `/audio/${audioFileName}`,
                cached: true,
                duration: await getAudioDuration(audioFilePath)
            });
        }
        
        // OpenAI TTS APIで音声生成
        const audioBuffer = await generateTTSWithOpenAI(text, voice || 'alloy');
        
        // ファイルに保存
        fs.writeFileSync(audioFilePath, audioBuffer);
        
        console.log(`✅ Generated TTS audio: ${audioFileName}`);
        
        res.json({
            success: true,
            audioUrl: `/audio/${audioFileName}`,
            cached: false,
            fileSize: audioBuffer.length,
            duration: await getAudioDuration(audioFilePath)
        });
        
    } catch (error) {
        console.error('TTS generation error:', error);
        res.status(500).json({
            error: 'TTS Generation Failed',
            message: 'Failed to generate audio'
        });
    }
});

// 音声ファイル提供エンドポイント
router.get('/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(AUDIO_DIR, filename);
    
    // セキュリティチェック
    if (!filename.match(/^tts_[a-f0-9]{32}\.mp3$/)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
    }
    
    // 音声ファイルを送信
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1年キャッシュ
    res.sendFile(filePath);
});

// OpenAI TTS APIで音声生成
async function generateTTSWithOpenAI(text, voice) {
    try {
        const response = await openaiClient.post('/audio/speech', {
            model: process.env.TTS_MODEL || 'tts-1',
            input: text,
            voice: voice,
            response_format: process.env.TTS_FORMAT || 'mp3',
            speed: 1.0
        }, {
            responseType: 'arraybuffer'
        });

        return Buffer.from(response.data);
        
    } catch (error) {
        console.error('OpenAI TTS error:', error.response?.data || error.message);
        throw new Error('Failed to generate speech with OpenAI TTS');
    }
}

// 音声ファイルの長さを取得（概算）
async function getAudioDuration(filePath) {
    try {
        const stats = fs.statSync(filePath);
        // MP3の概算：1KB ≈ 0.125秒（128kbps想定）
        const durationSeconds = Math.round((stats.size / 1024) * 0.125);
        return Math.max(1, durationSeconds); // 最低1秒
    } catch (error) {
        return 30; // フォールバック値
    }
}

// 音声ファイル一覧取得（管理用）
router.get('/', (req, res) => {
    try {
        const files = fs.readdirSync(AUDIO_DIR)
            .filter(file => file.endsWith('.mp3'))
            .map(file => {
                const filePath = path.join(AUDIO_DIR, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    created: stats.birthtime,
                    url: `/api/tts/${file}`
                };
            })
            .sort((a, b) => b.created - a.created);
            
        res.json({
            success: true,
            files: files,
            count: files.length,
            totalSize: files.reduce((sum, file) => sum + file.size, 0)
        });
    } catch (error) {
        console.error('Audio file list error:', error);
        res.status(500).json({
            error: 'Failed to list audio files'
        });
    }
});

// 古い音声ファイルの削除（クリーンアップ）
router.delete('/cleanup', (req, res) => {
    try {
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7日
        const now = Date.now();
        let deletedCount = 0;
        let deletedSize = 0;
        
        const files = fs.readdirSync(AUDIO_DIR)
            .filter(file => file.endsWith('.mp3'));
            
        for (const file of files) {
            const filePath = path.join(AUDIO_DIR, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.birthtime.getTime() > maxAge) {
                deletedSize += stats.size;
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        }
        
        console.log(`🧹 Cleaned up ${deletedCount} old audio files (${Math.round(deletedSize / 1024)} KB)`);
        
        res.json({
            success: true,
            deletedCount: deletedCount,
            deletedSize: deletedSize,
            message: `Deleted ${deletedCount} files older than 7 days`
        });
        
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            error: 'Cleanup failed'
        });
    }
});

module.exports = router;