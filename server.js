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
{"tarih":"GG.AA.YYYY","tedarikci":"firma adı","aciklama":"kısa özet","odeme_turu":"Nakit veya Kredi Kartı","kdv_satirlari":[{"oran":18,"matrah":100.00,"kdv_tutari":18.00}],"toplam_matrah":100.00,"toplam_kdv":18.00,"genel_toplam":118.00}`;

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
  console.log('API yanıtı:', JSON.stringify(data).substring(0, 200));
  
  const text = data.content[0].text;
  console.log('Ham metin:', text.substring(0, 200));
  
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!parsed.kdv_satirlari) parsed.kdv_satirlari = [];
  return parsed;
}

app.listen(process.env.PORT || 3000, () => console.log('Sunucu çalışıyor'));
