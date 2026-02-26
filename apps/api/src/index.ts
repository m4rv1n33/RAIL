import { config } from "dotenv";
import { createApp } from "./app.js";
import { initDiscordLogRelay } from "./logRelay.js";

config({ path: new URL("../.env", import.meta.url) });
config();
initDiscordLogRelay("api");

const app = createApp();
const port = Number(process.env.PORT || 3001);

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
