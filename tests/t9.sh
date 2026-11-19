export FAKEDIR=$KH_TESTS/fake
. $KH_TESTS/env.sh
: > $FAKEDIR/urls.log
printf 'http://feed1.example/rss|CKPG "x" \\\\|5\r\nhttp://feed2.example/rss|DEAD|3\r\n' > $HUB_DIR/news.conf
rm -f $HUB_DIR/cacert.pem
CURL_BIN=$FAKEDIR/curl sh $HUB_DIR/sync_data.sh
tail -14 $HUB_DIR/sync.log
echo "--- data.js parses as JS?"; node -e "global.window={};require('vm').runInNewContext(require('fs').readFileSync('$HUB_DIR/mesquite/data.js','utf8'),{window:global.window});const d=global.window.HUB_DATA;console.log('ok stories',d.articles.length,'src',JSON.stringify(d.articles[0].s),'img',d.articles[0].img,'otd',JSON.stringify(d.onThisDay))"
echo "--- second run with every feed dead: keeps last news + weather?"
sed -i 's/\*open-meteo\*)/*NOPE*)/; s/\*feed1\*)/*NOPE2*)/' $FAKEDIR/curl
rm -f $HUB_DIR/.otd_*; CURL_BIN=$FAKEDIR/curl sh $HUB_DIR/sync_data.sh; tail -6 $HUB_DIR/sync.log
node -e "global.window={};require('vm').runInNewContext(require('fs').readFileSync('$HUB_DIR/mesquite/data.js','utf8'),{window:global.window});const d=global.window.HUB_DATA;console.log('ok stories',d.articles.length,'wx',!!d.wx)"
sed -i 's/\*NOPE\*)/*open-meteo*)/; s/\*NOPE2\*)/*feed1*)/' $FAKEDIR/curl
