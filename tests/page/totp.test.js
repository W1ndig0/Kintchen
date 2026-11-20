// 10.9: the Kindle's authenticator check (mesquite/v109.js HubTotp) against the RFC 6238 test values and Python's hmac.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const src = fs.readFileSync(path.join(__dirname, "../../kindle/shiftcal/mesquite/v109.js"), "utf8");
const a = src.indexOf("var HubTotp = (function"), b = src.indexOf("})();", a) + 5;
const T = new Function(src.slice(a, b) + "; return HubTotp;")();
let fails = 0; function check(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const S = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";      // "12345678901234567890"
const rfc = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]];
rfc.forEach(([t, c]) => check(T.code(S, Math.floor(t / 30)) === c, "RFC 6238 time " + t + " -> " + c));
check(T.verify(S, "287082", 59000) && T.verify(S, "287082", 59000 + 30000) && T.verify(S, "287082", 59000 - 29000), "a code is accepted 30 s either side");
check(!T.verify(S, "287082", 59000 + 61000), "an old code (2 steps later) is refused");
check(!T.verify(S, "28708", 59000) && !T.verify(S, "abcdef", 59000) && !T.verify("", "287082", 59000), "short, non-digit or no secret: refused");
// a random secret: same as Python's hmac/sha1
const sec = "NFQNFNUOHUSMXK2QQIYFJ4UEBHDNO5V4", now = 1795133321000;
let py = "";
try {
  py = cp.execFileSync("python3", ["-I", "-c", "import base64,hmac,hashlib,struct,sys\ns=base64.b32decode(sys.argv[1]);c=int(sys.argv[2])//30000\nh=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest();o=h[19]&15\nprint('%06d'%((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000))", sec, String(now)]).toString().trim();
} catch (e) { py = ""; }
if (py) check(T.code(sec, Math.floor(now / 30000)) === py, "random secret matches Python's hmac (" + py + ")");
const hex = a => a.map(x => (x < 16 ? "0" : "") + x.toString(16)).join("");
check(hex(T.sha1(Array.from(Buffer.from("abc")))) === "a9993e364706816aba3e25717850c26c9cd0d89d", "SHA-1('abc')");
check(hex(T.sha1(Array.from(Buffer.from("a".repeat(1000))))) === require("crypto").createHash("sha1").update("a".repeat(1000)).digest("hex"), "SHA-1 of a long message");
process.exit(fails ? 1 : 0);
