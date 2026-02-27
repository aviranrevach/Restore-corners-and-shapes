const fs = require("fs");
const timestamp = new Date().toISOString();
// Inject into compiled code.js so we don't use require/exports (Figma sandbox doesn't support them)
const codePath = "code.js";
let js = fs.readFileSync(codePath, "utf8");
js = js.replace(
  /const BUILD_TIMESTAMP = "";/,
  `const BUILD_TIMESTAMP = "${timestamp}";`
);
fs.writeFileSync(codePath, js, "utf8");
