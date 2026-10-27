// 模拟 DeepSeek 的 /chat/completions，用来验证「AI 记账」整条链路
// 用法：node mock-ai.mjs
import http from 'node:http';

const PORT = 8777;

const CORS = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const server = http.createServer((req, res) => {
  CORS(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (e) { /* ignore */ }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer bad-key') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"Authentication Fails"}}');
      return;
    }

    const msgs = parsed.messages || [];
    const last = msgs.length ? msgs[msgs.length - 1].content : '';

    let content;
    if (last.indexOf('正常') >= 0) {
      content = '正常';
    } else if (last.indexOf('AA') >= 0 || last.indexOf('垫') >= 0) {
      // 故意包一层 markdown 代码块 + 前后废话，测试提取逻辑
      content = '好的，解析结果如下：\n```json\n' +
        '{"type":"expense","amount":180,"category":"伙食","item":"和小李AA","account":"微信","date":"2026-10-27"}\n' +
        '```\n希望有帮助。';
    } else if (last.indexOf('工资') >= 0) {
      content = '{"type":"income","amount":8000,"category":"工资","item":"十月工资","account":"银行卡","date":"2026-10-27"}';
    } else if (last.indexOf('乱说') >= 0) {
      content = '我不太明白你的意思。';
    } else {
      content = '{"type":"expense","amount":25,"category":"伙食","item":"午饭","account":"微信","date":"2026-10-27"}';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock-1',
      object: 'chat.completion',
      model: parsed.model || 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
    }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock AI listening on http://127.0.0.1:' + PORT);
});
