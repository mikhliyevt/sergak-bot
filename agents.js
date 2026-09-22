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

// Agentlarni xavfsiz ishga tushirish
async function initAgents() {
  for (const cfg of agentConfigs) {
    if (!cfg.apiId || !cfg.apiHash || !cfg.session || cfg.session.trim() === "") {
      console.log(`[AGENT ${cfg.id}] Session kaliti hali biriktirilmagan.`);
      continue;
    }
    try {
      const client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
        connectionRetries: 3,
      });
      await client.connect();
      clients.push({ id: cfg.id, client });
      console.log(`✅ [AGENT ${cfg.id}] Muvaffaqiyatli ulana olindi!`);
    } catch (err) {
      console.log(`❌ [AGENT ${cfg.id}] Ulanishda xatolik:`, err.message);
    }
  }
}

function getNextClient() {
  if (clients.length === 0) return null;
  const clientObj = clients[currentAgentIndex];
  currentAgentIndex = (currentAgentIndex + 1) % clients.length;
  return clientObj;
}

async function fetchUserStories(username) {
  if (clients.length === 0) {
    throw new Error("Agentlar sessiyasi (.env parametrida) hali kiritilmagan!");
  }

  let attempts = 0;
  while (attempts < clients.length) {
    const agentObj = getNextClient();
    try {
      const user = await agentObj.client.getEntity(username);
      const peerStories = await agentObj.client.invoke(
        new Api.stories.GetPeerStories({ peer: user })
      );

      return {
        user,
        stories: peerStories.stories ? peerStories.stories.stories : []
      };
    } catch (err) {
      console.log(`[AGENT-${agentObj.id} XATO]:`, err.message);
      attempts++;
    }
  }

  throw new Error("Story'larni olib bo'lmadi yoki profil topilmadi.");
}

module.exports = {
  initAgents,
  fetchUserStories
};
