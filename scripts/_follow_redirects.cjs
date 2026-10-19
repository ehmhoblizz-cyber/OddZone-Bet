// Follows the 308 redirects to see where the live site actually sends a game request.
const https = require('https');

const PATHS = [
    'games/star-shooter-3d/index.html',
    'games/standalone/breakout.html',
    'games/hextris/index.html',
];

const req = (path) => new Promise((resolve) => {
    const u = 'https://oddzone-bet.vercel.app/' + path;
    const r = https.get(u, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({
            status: res.statusCode,
            location: res.headers.location || '',
            len: b.length,
            body: b
        }));
    });
    r.on('error', e => resolve({ status: 0, location: '', len: 0, body: '', err: e.message }));
});

(async () => {
    for (const p of PATHS) {
        console.log('--- /' + p);
        const first = await req(p);
        console.log('   1st:', first.status, '->', first.location || '(no redirect)');

        if (first.location) {
            const target = first.location.startsWith('http')
                ? first.location
                : 'https://oddzone-bet.vercel.app' + first.location;
            const second = await new Promise((resolve) => {
                https.get(target, (res) => {
                    let b = '';
                    res.on('data', c => b += c);
                    res.on('end', () => resolve({ status: res.statusCode, len: b.length, body: b }));
                }).on('error', e => resolve({ status: 0, len: 0, body: '', err: e.message }));
            });
            const is404 = second.body.includes("isn't in the arena") || second.body.includes('Page not found');
            console.log('   2nd:', second.status, 'len=' + second.len, 'is404page=' + is404, '  ' + target);
            if (is404) console.log('        >> lands on the 404 card, NOT the game');
        }
    }
    process.exit(0);
})();
