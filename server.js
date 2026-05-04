const express = require('express');
const multer = require('multer');

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
    console.error('HATA:', e.message);
    res.json({ ok: false, hata: e.message });
  }
});

async function fisCoz(b64, mime) {
  const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
  
  const prompt = `Bu bir Türk kasa fişi veya faturasıdır. Sadece aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "tarih": "GG.AA.YYYY",
  "fis_no": "fiş numarası veya fatura no, yoksa boş string",
  "tedarikci": "firma adı",
  "aciklama": "kısa özet",
  "odeme_turu": "Nakit veya Kredi Karti",
  "kart_son4": "kredi karti son 4 hanesi, nakit ise bos string",
  "kdv_satirlari": [
    {
      "oran": 18,
      "kdvli_toplam": 118.00,
      "kdv_tutari": 18.00,
      "matrah": 100.00
    }
  ],
  "toplam_matrah": 100.00,
  "toplam_kdv": 18.00,
  "genel_toplam": 118.00
}

Onemli:
- kdvli_toplam: fiste yazan KDV dahil fiyat
- kdv_tutari: sadece KDV miktari
- matrah: kdvli_toplam - kdv_tutari
- Birden fazla KDV orani varsa hepsini ayri yaz
- kart_son4: fiste "****1234" gibi yaziyorsa "1234" yaz`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
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
  console.log('API yaniti:', JSON.stringify(data).substring(0, 200));
  
  const text = data.content[0].text;
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!parsed.kdv_satirlari) parsed.kdv_satirlari = [];
  return parsed;
}

function para(sayi) {
  if (sayi == null || isNaN(sayi)) return '0,00';
  return Number(sayi).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

if (process.env.TELEGRAM_TOKEN) {
  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
  const userFisler = {};

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, 'Fis okunuyor...');
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await bot.getFile(photo.file_id);
      const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
      const imgResp = await fetch(url);
      const buffer = await imgResp.buffer();
      const b64 = buffer.toString('base64');
      const r = await fisCoz(b64, 'image/jpeg');

      if (!userFisler[chatId]) userFisler[chatId] = [];
      userFisler[chatId].push(r);

      const kdvSatir = r.kdv_satirlari.map(k =>
        `%${k.oran} - Matrah: ${para(k.matrah)} | KDV: ${para(k.kdv_tutari)} | Toplam: ${para(k.kdvli_toplam)}`
      ).join('\n');

      const mesaj = 
        `${r.tedarikci} - ${r.tarih}${r.fis_no ? ' (Fis: ' + r.fis_no + ')' : ''}\n` +
        `${r.aciklama}\n` +
        `${r.odeme_turu}${r.kart_son4 ? ' *' + r.kart_son4 : ''}\n\n` +
        `KDV Detayi:\n${kdvSatir}\n\n` +
        `Matrah: ${para(r.toplam_matrah)} | KDV: ${para(r.toplam_kdv)} | Toplam: ${para(r.genel_toplam)}\n\n` +
        `Toplam ${userFisler[chatId].length} fis birikti. CSV almak icin /csv yaz.`;

      await bot.sendMessage(chatId, mesaj);
    } catch(e) {
      console.error('Telegram hata:', e.message);
      await bot.sendMessage(chatId, 'Fis okunamadi, tekrar dene.');
    }
  });

  bot.onText(/\/csv/, async (msg) => {
    const chatId = msg.chat.id;
    const fisler = userFisler[chatId];
    if (!fisler || fisler.length === 0) {
      await bot.sendMessage(chatId, 'Henuz fis yok. Once fis fotografı gonder.');
      return;
    }
    const baslik = ['Tarih','Fis No','Tedarikci','Aciklama','KDV %','Matrah','KDV Tutari','KDVli Toplam','Odeme','Kart Son 4'];
    const satirlar = [baslik.join(';')];
    fisler.forEach(r => {
      const kdvler = r.kdv_satirlari && r.kdv_satirlari.length ? r.kdv_satirlari : [{oran:'', kdvli_toplam: r.genel_toplam, kdv_tutari: r.toplam_kdv, matrah: r.toplam_matrah}];
      kdvler.forEach(k => {
        satirlar.push([r.tarih, r.fis_no||'', r.tedarikci, r.aciklama, k.oran, para(k.matrah), para(k.kdv_tutari), para(k.kdvli_toplam), r.odeme_turu, r.kart_son4||''].join(';'));
      });
      satirlar.push(['', '', r.tedarikci + ' TOPLAM', '', '', para(r.toplam_matrah), para(r.toplam_kdv), para(r.genel_toplam), '', ''].join(';'));
    });
    const csv = '\uFEFF' + satirlar.join('\n');
    const buf = Buffer.from(csv, 'utf8');
    await bot.sendDocument(chatId, buf, {}, { filename: 'fisler.csv', contentType: 'text/csv' });
    userFisler[chatId] = [];
    await bot.sendMessage(chatId, 'CSV gonderildi, liste sifirlandı.');
  });

  bot.onText(/\/temizle/, async (msg) => {
    userFisler[msg.chat.id] = [];
    await bot.sendMessage(msg.chat.id, 'Liste temizlendi.');
  });

  bot.onText(/\/durum/, async (msg) => {
    const chatId = msg.chat.id;
    const sayi = (userFisler[chatId] || []).length;
    await bot.sendMessage(chatId, `Su an ${sayi} fis birikmus.`);
  });

  console.log('Telegram botu aktif');
}

app.listen(process.env.PORT || 3000, () => console.log('Sunucu calisiyor'));
