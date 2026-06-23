const fs = require("node:fs");
const path = require("node:path");

const settingsPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@react-native",
  "gradle-plugin",
  "settings.gradle.kts"
);

const oldResolver =
  'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const newResolver =
  'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';

if (!fs.existsSync(settingsPath)) {
  throw new Error(`React Native Gradle settings not found: ${settingsPath}`);
}

const settings = fs.readFileSync(settingsPath, "utf8");

if (settings.includes(newResolver)) {
  console.log("React Native Gradle toolchain resolver is already compatible.");
} else if (settings.includes(oldResolver)) {
  fs.writeFileSync(settingsPath, settings.replace(oldResolver, newResolver));
  console.log("Updated React Native Gradle toolchain resolver for Gradle 9.");
} else {
  throw new Error(
    "Unexpected React Native Gradle resolver version; review the compatibility patch."
  );
}
