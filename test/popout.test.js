"use strict";
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "core.js"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

global.window = global;
global.screen = { availWidth: 1920, availHeight: 1080 };
global.document = { documentElement: {}, querySelectorAll: () => [], querySelector: () => null };
global.getComputedStyle = () => ({ objectFit: "contain", display: "block", visibility: "visible" });

function loadCore(hostname, search, pathname) {
  global.location = { hostname: hostname, search: search || "", pathname: pathname || "/" };
  delete global.window.__TC;
  eval(SRC);
  return global.window.__TC;
}

console.log("\nplayer.twitch.tv (the popout window)");
const pop = loadCore("player.twitch.tv", "?channel=emiru&parent=twitch.tv&player=popout");
ok("isPopout is true", pop.isPopout === true);
const pi1 = pop.pageInfo();
ok("channel parsed from ?channel=", pi1.channel === "emiru" && pi1.kind === "channel", pi1);
ok("crop key would match the main site", "crop:c:" + pi1.channel === "crop:c:emiru");
const popVod = loadCore("player.twitch.tv", "?video=1234567&parent=twitch.tv");
const pi2 = popVod.pageInfo();
ok("?video= parsed as a VOD", pi2.kind === "vod" && pi2.videoId === "1234567", pi2);
ok("loop key would match", "loop:v:" + pi2.videoId === "loop:v:1234567");

console.log("\nmain site: popout URL");
const main = loadCore("www.twitch.tv", "", "/emiru");
ok("isPopout is false on the main site", main.isPopout === false);
const url = main.popoutUrl();
ok("points at player.twitch.tv", url.indexOf("https://player.twitch.tv/?") === 0, url);
ok("carries the channel", url.indexOf("channel=emiru") !== -1, url);
ok("uses parent=twitch.tv (what Twitch itself uses)", url.indexOf("parent=twitch.tv") !== -1, url);
ok("asks for the popout player", url.indexOf("player=popout") !== -1, url);
ok("has no video param for a live channel", url.indexOf("video=") === -1, url);

const vodCore = loadCore("www.twitch.tv", "", "/videos/999");
const vodUrl = vodCore.popoutUrl();
ok("VOD popout uses ?video=", vodUrl.indexOf("video=999") !== -1 && vodUrl.indexOf("channel=") === -1, vodUrl);

const none = loadCore("www.twitch.tv", "", "/directory");
ok("returns null when there is no channel or video", none.popoutUrl() === null);

console.log("\nreturn URL (where the popout sends the tab back)");
const rp = loadCore("player.twitch.tv", "?channel=emiru&parent=twitch.tv");
ok("popout with a channel -> the channel page", rp.returnUrl() === "https://www.twitch.tv/emiru", rp.returnUrl());
const rpVod = loadCore("player.twitch.tv", "?video=1234567&parent=twitch.tv");
ok("popout with a video -> the video page", rpVod.returnUrl() === "https://www.twitch.tv/videos/1234567", rpVod.returnUrl());
const rpMain = loadCore("www.twitch.tv", "", "/emiru");
ok("main channel page", rpMain.returnUrl() === "https://www.twitch.tv/emiru", rpMain.returnUrl());
const rpHome = loadCore("www.twitch.tv", "", "/directory");
ok("no channel -> twitch home", rpHome.returnUrl() === "https://www.twitch.tv/", rpHome.returnUrl());

console.log("\nmain site: window size fitted to the crop");
const sizer = loadCore("www.twitch.tv", "", "/emiru");
sizer.state.video = { videoWidth: 1920, videoHeight: 1080 };

sizer.state.crop = { enabled: true, x: 0, y: 0, w: 0.217, h: 0.565, mode: "fit" };
const webcam = sizer.popoutSize();
const wantAspect = (0.217 * 1920) / (0.565 * 1080);
ok("webcam crop => portrait window", webcam.height > webcam.width, webcam);
ok("aspect matches the crop", near(webcam.width / webcam.height, wantAspect, 0.01), {
  got: webcam.width / webcam.height, want: wantAspect
});
ok("fits inside the screen", webcam.width <= 1728 && webcam.height <= 972, webcam);

sizer.state.crop = { enabled: true, x: 0, y: 0, w: 1, h: 1, mode: "fit" };
const full = sizer.popoutSize();
ok("full-frame crop => 16:9 window", full.width === 1728 && full.height === 972, full);
ok("aspect is 16:9", near(full.width / full.height, 1920 / 1080, 0.01), full);

sizer.state.crop = { enabled: true, x: 0, y: 0, w: 1, h: 0.25, mode: "fit" };
const wide = sizer.popoutSize();
ok("very wide crop => wide, short window", wide.width > wide.height, wide);
ok("never taller than the screen", wide.height <= 972, wide);

console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED" : pass + " passed, " + fail + " FAILED"));
process.exit(fail === 0 ? 0 : 1);
