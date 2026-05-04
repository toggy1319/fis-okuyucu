const express = require('express');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.static('public'));
app.use(express.json());

app.post('/api/oku-fis', upload.single('fis'), async (req, res) => {
  try {
    const b64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;
    const sonuc = await fisCoz(b64, mime);
    res.json({ ok: true, data: sonuc });
  } catch (e) {
    res.json({ ok: false, hata: e.message });
  }
});

async function fisCoz(b64, mime) {
  const prompt = `Bu bir Türk kasa fişi veya faturasıdır. Aşağıdaki bilgileri JSON formatında çıkar:
{
  "tarih": "GG.AA.YYYY",
  "tedarikci": "firma adı",
  "aciklama": "ne alındığının kısa özeti",
  "odeme_turu": "Nakit / Kredi Kartı / Diğer",
  "kdv_satirlari": [{ "oran": 18, "matrah": 100.00, "kdv_tutari": 18.00 }],
  "toplam_matrah": 100.00,
  "toplam_kdv": 18.00,
  "genel_toplam": 118.00
}
Birden fazla KDV oranı varsa hepsini ayrı yaz. Sadece JSON döndür.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  const data = await resp.json();
  const text = data.content.map(i => i.text || '').join('');
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
if (!parsed.kdv_satirlari) parsed.kdv_satirlari = [];
return parsed;
}

if (process.env.TELEGRAM_TOKEN) {
  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '📄 Fiş okunuyor...');
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await bot.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
      const imgResp = await fetch(url);
      const buffer = await imgResp.buffer();
      const b64 = buffer.toString('base64');
      const r = await fisCoz(b64, 'image/jpeg');

      const kdvSatir = r.kdv_satirlari.map(k =>
        `  • %${k.oran} → Matrah: ₺${k.matrah.toFixed(2)} | KDV: ₺${k.kdv_tutari.toFixed(2)}`
      ).join('\n');

      await bot.sendMessage(chatId,
        `✅ *${r.tedarikci}* — ${r.tarih}\n` +
        `📝 ${r.aciklama}\n\n` +
        `*KDV Detayı:*\n${kdvSatir}\n\n` +
        `Matrah: ₺${r.toplam_matrah.toFixed(2)}\n` +
        `KDV: ₺${r.toplam_kdv.toFixed(2)}\n` +
        `*Toplam: ₺${r.genel_toplam.toFixed(2)}*\n` +
        `Ödeme: ${r.odeme_turu}`,
        { parse_mode: 'Markdown' }
      );
    } catch(e) {
      await bot.sendMessage(chatId, '❌ Fiş okunamadı, tekrar dene.');
    }
  });
  console.log('Telegram botu aktif');
}

app.listen(process.env.PORT || 3000, () => console.log('Sunucu çalışıyor'));
