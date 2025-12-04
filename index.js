require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');

// --- SOZLAMALAR ---
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// Yuklash papkasi
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

// --- RENDER KEEP-ALIVE (UXLAMASLIK) ---
app.get('/', (req, res) => res.send('Super Bot Ishlamoqda! 🔥'));
app.listen(PORT, () => console.log(`Server ${PORT} da ishga tushdi`));

// --- YORDAMCHI FUNKSIYALAR ---

// yt-dlp orqali ma'lumot olish
function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const process = spawn('yt-dlp', ['--dump-json', url]);
        let data = '';
        process.stdout.on('data', (chunk) => data += chunk);
        process.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject('JSON parsing error');
                }
            } else {
                reject('Process failed');
            }
        });
    });
}

// Videoni yuklash funksiyasi
function downloadVideo(url, formatId, outputName) {
    return new Promise((resolve, reject) => {
        // Format tanlash: Agar formatId bo'lsa o'shani, bo'lmasa "bestvideo+bestaudio"
        const args = [
            '--format', formatId ? `${formatId}+bestaudio/best` : 'bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '-o', outputName,
            url
        ];

        // Instagram uchun maxsus sozlama (cookiesiz yuklashga urinish)
        if (url.includes('instagram.com')) {
            args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        }

        const process = spawn('yt-dlp', args);

        process.on('close', (code) => {
            if (code === 0) resolve(outputName);
            else reject('Download failed');
        });
    });
}

// --- BOT LOGIKASI ---

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "👋 **Super YuklaBot**ga xush kelibsiz!\n\nYouTube yoki Instagram link tashlang. Men eng yuqori sifatda (1080p+) yuklab beraman.\n\n_Bot 100% `yt-dlp` texnologiyasida ishlaydi._", { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Link tekshirilmoqda...**");

    try {
        const info = await getVideoInfo(text);
        const title = info.title || 'Video';
        const duration = info.duration;
        const videoId = info.id;
        const thumbnail = info.thumbnail;

        // Agar Shorts yoki Instagram bo'lsa - SROZU yuklaymiz (tanlash shart emas)
        const isShorts = (duration < 65 && text.includes('youtube')) || text.includes('shorts');
        const isInstagram = text.includes('instagram.com');

        if (isShorts || isInstagram) {
            bot.editMessageText(`⏳ **Yuklanmoqda...**\n\n📌 ${title}`, { chat_id: chatId, message_id: waitMsg.message_id });
            
            const filePath = path.join(DOWNLOAD_DIR, `${videoId}.mp4`);
            // Format tanlamaymiz, avtomatik eng yaxshisini oladi
            await downloadVideo(text, null, filePath);

            // Telegram 50MB limiti tekshiruvi
            const stats = fs.statSync(filePath);
            const sizeMB = stats.size / (1024 * 1024);

            if (sizeMB < 49) {
                await bot.sendVideo(chatId, fs.createReadStream(filePath), { caption: `✅ ${title}\n🤖 @SizningBotingiz` });
            } else {
                bot.sendMessage(chatId, `⚠️ **Fayl juda katta (${sizeMB.toFixed(1)} MB).**\nTelegram boti orqali 50MB dan katta fayl yuborib bo'lmaydi.`);
            }
            
            // Faylni o'chirish
            fs.unlinkSync(filePath);
            bot.deleteMessage(chatId, waitMsg.message_id);

        } else {
            // YouTube uzun videolar - FORMAT TANLASH
            const formats = info.formats.filter(f => f.ext === 'mp4' && f.vcodec !== 'none');
            
            // Tugmalar (faqat 1080p, 720p, 480p)
            let uniqueQualities = new Set();
            let buttons = [];

            // Eng yaxshi formatlarni saralash
            formats.forEach(f => {
                if(f.height && !uniqueQualities.has(f.height)) {
                   if ([1080, 720, 480, 360].includes(f.height)) {
                       uniqueQualities.add(f.height);
                       buttons.push([{
                           text: `🎥 ${f.height}p (Video+Audio)`,
                           callback_data: JSON.stringify({ id: videoId, h: f.height, u: 'yt' })
                       }]);
                   }
                }
            });
            // Saralash (kattadan kichikka)
            buttons.sort((a, b) => parseInt(b[0].text) - parseInt(a[0].text));
            buttons.push([{ text: "🎵 Faqat Audio (MP3)", callback_data: JSON.stringify({ id: videoId, type: 'audio' }) }]);

            bot.deleteMessage(chatId, waitMsg.message_id);
            bot.sendPhoto(chatId, thumbnail, {
                caption: `🎬 **${title}**\n⏱ Davomiyligi: ${Math.floor(duration/60)}:${duration%60}\n\n👇 Sifatni tanlang:`,
                reply_markup: { inline_keyboard: buttons }
            });
        }

    } catch (error) {
        console.error(error);
        bot.editMessageText("⚠️ **Xatolik:** Link noto'g'ri yoki video yopiq profilga tegishli.\n\n_Eslatma: Instagram 'Private' profillarni yuklab bo'lmaydi._", { chat_id: chatId, message_id: waitMsg.message_id });
    }
});

// --- CALLBACK (Tugma bosilganda) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = JSON.parse(query.data);
    const videoUrl = `https://www.youtube.com/watch?v=${data.id}`;

    bot.deleteMessage(chatId, query.message.message_id);
    const progressMsg = await bot.sendMessage(chatId, `⏳ **Serverga yuklanmoqda...**\nSifat: ${data.h || 'Audio'}p`);

    try {
        const outputName = path.join(DOWNLOAD_DIR, `${data.id}_${Date.now()}.mp4`);
        
        // Format ID ni topish (yt-dlp sintaksisi bo'yicha)
        // bestvideo[height<=1080]+bestaudio/best
        const formatSelector = data.type === 'audio' 
            ? 'bestaudio' 
            : `bestvideo[height<=${data.h}]+bestaudio/best`;

        await downloadVideo(videoUrl, formatSelector, outputName);

        // Limitni tekshirish
        const stats = fs.statSync(outputName);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > 49) {
            bot.sendMessage(chatId, `❌ **Kechirasiz, video hajmi ${sizeMB.toFixed(1)}MB.**\nTelegram boti orqali 50MB dan katta fayllarni yuborish imkonsiz (Telegram cheklovi).`);
        } else {
             await bot.sendChatAction(chatId, 'upload_video');
             if (data.type === 'audio') {
                 await bot.sendAudio(chatId, fs.createReadStream(outputName));
             } else {
                 await bot.sendVideo(chatId, fs.createReadStream(outputName), { caption: '✅ Muvaffaqiyatli yuklandi!' });
             }
        }

        fs.unlinkSync(outputName);
        bot.deleteMessage(chatId, progressMsg.message_id);

    } catch (err) {
        console.log(err);
        bot.editMessageText("❌ Yuklashda jiddiy xatolik bo'ldi.", { chat_id: chatId, message_id: progressMsg.message_id });
    }
});