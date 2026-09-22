const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");

const agentConfigs = [
  {
    id: 1,
    apiId: parseInt(process.env.AGENT1_API_ID),
    apiHash: process.env.AGENT1_API_HASH,
    session: process.env.AGENT1_SESSION || ""
  },
  {
    id: 2,
    apiId: parseInt(process.env.AGENT2_API_ID),
    apiHash: process.env.AGENT2_API_HASH,
    session: process.env.AGENT2_SESSION || ""
  }
];

const clients = [];
let currentAgentIndex = 0;

// Agentlarni ishga tushirish
async function initAgents() {
  for (const cfg of agentConfigs) {
    if (!cfg.apiId || !cfg.apiHash || !cfg.session) {
      console.log(`[AGENT ${cfg.id}] Session yoki API kalitlar kiritilmagan. O'tkazib yuborildi.`);
      continue;
    }
    try {
      const client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
        connectionRetries: 5,
      });
      await client.connect();
      clients.push({ id: cfg.id, client });
      console.log(`✅ [AGENT ${cfg.id}] Muvaffaqiyatli ulana olindi!`);
    } catch (err) {
      console.log(`❌ [AGENT ${cfg.id}] Ulanishda xatolik:`, err.message);
    }
  }
}

// Bo'sh turgan yoki navbatdagi Agentni olish (Rotation)
function getNextClient() {
  if (clients.length === 0) return null;
  const clientObj = clients[currentAgentIndex];
  currentAgentIndex = (currentAgentIndex + 1) % clients.length;
  return clientObj;
}

// User story'larini ko'rish va yuklash
async function fetchUserStories(username) {
  if (clients.length === 0) {
    throw new Error("Hali hech qaysi Agent akkaunt faollashtirilmagan!");
  }

  let attempts = 0;
  while (attempts < clients.length) {
    const agentObj = getNextClient();
    console.log(`[STORY FETCH] Agent-${agentObj.id} orqali @${username} qidirilmoqda...`);

    try {
      // Userni qidirish
      const user = await agentObj.client.getEntity(username);
      
      // Story'larni olish
      const peerStories = await agentObj.client.invoke(
        new Api.stories.GetPeerStories({
          peer: user
        })
      );

      return {
        user,
        stories: peerStories.stories ? peerStories.stories.stories : []
      };

    } catch (err) {
      console.log(`[AGENT-${agentObj.id} XATO]:`, err.message);
      attempts++; // Agar ushbu agentni victim bloklagan bo'lsa yoki xato bersa, keyingi agentga o'tadi
    }
  }

  throw new Error("Barcha Agentlar bloklangan yoki story topilmadi.");
}

module.exports = {
  initAgents,
  fetchUserStories
};
