require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Groq } = require('groq-sdk');
const cron = require('node-cron');
const moment = require('moment-timezone');
const axios = require('axios');
const cheerio = require('cheerio');

// Utility: Fetch and summarize AQW Wiki page
async function fetchAQWWikiSummary(query) {
  try {
    // Extract key term from the prompt
const matched = query.match(/(?:how|where).*?\b(get|find|obtain)\b\s+(.*)/i);
const itemQuery = matched ? matched[2] : query;

// Format into slug
const formattedSlug = itemQuery.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');


    // Optional hardcoded map for known redirects
    const knownPages = {
      "legion-revenant": "legion-revenant-class",
      "void-highlord": "void-highlord-class",
      "shadow-reaper-of-doom": "shadow-reaper-of-doom",
    };

    const slug = knownPages[formattedSlug] || formattedSlug;
    const wikiUrl = `http://aqwwiki.wikidot.com/${slug}`;

    // Try to fetch the wiki page directly
    const pageRes = await axios.get(wikiUrl);
    const $ = cheerio.load(pageRes.data);

    const title = $('#page-title').text().trim();
    const content = [];

    const sections = {
      'Requirements': ['#requirements', '.requirements'],
      'Location': ['#location', '.location'],
      'How to Obtain': ['#how-to-obtain', '.how-to-obtain'],
      'Description': ['#description', '.description'],
      'Notes': ['#notes', '.notes']
    };

    if (title) content.push(`**${title}**\n`);

    for (const [name, selectors] of Object.entries(sections)) {
      for (const selector of selectors) {
        const sectionContent = $(selector).text().trim();
        if (sectionContent) {
          content.push(`**${name}:**\n${sectionContent}`);
          break;
        }
      }
    }

    if (content.length <= 1) {
      const mainContent = $('.page-content').text().replace(/\s+/g, ' ').trim();
      if (mainContent) content.push(mainContent);
    }

    let summary = content.join('\n\n');
    if (summary.length > 1000) {
      summary = summary.slice(0, 1000) + '...\n\nCheck the wiki link below for complete information.';
    }

    return {
      summary: summary || "No detailed information found. Please check the wiki link for more details.",
      url: wikiUrl
    };
  } catch (err) {
    console.error('AQW Wiki fetch error:', err.message);
    return {
      summary: null,
      url: `http://aqwwiki.wikidot.com/search:main/q/${encodeURIComponent(query)}`
    };
  }
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const memory = {}; // Per-channel memory
const eventLog = []; // Tracks server events
const bannedWords = ['nigger', 'faggot', 'niga', 'rape', 'childporn', 'nigga', 'niga', 'f*ggot', 'fggt']; // <- you can add more here
const modLogChannelId = '1347501837049401437'; // replace with actual log channel ID

function addToMemory(channelId, userPrompt, botReply) {
  if (!memory[channelId]) memory[channelId] = [];
  memory[channelId].push({ prompt: userPrompt, reply: botReply });
  if (memory[channelId].length > 5) memory[channelId].shift(); // Keep only last 5
}

function logEvent(text) {
  eventLog.push(`[${new Date().toLocaleTimeString()}] ${text}`);
  if (eventLog.length > 20) eventLog.shift(); // limit to 20 entries
}

client.once('ready', async () => {
  console.log(`🤖 CruelAI is online as ${client.user.tag}`);
  try {
    await client.user.setPresence({
      activities: [{ name: '!cruelai to use me', type: 0 }],
      status: 'online',
    });
  } catch (err) {
    console.error('❌ Failed to set presence:', err.message);
  }
});

// Track member joins and leaves
client.on('guildMemberAdd', member => {
  logEvent(`${member.user.tag} joined the server`);
});
client.on('guildMemberRemove', member => {
  logEvent(`${member.user.tag} left the server`);
});

// Track deleted messages
client.on('messageDelete', msg => {
  if (!msg.partial) {
    logEvent(`A message from ${msg.author?.tag || 'Unknown'} was deleted`);
  }
});

function containsBannedWords(content) {
  return bannedWords.find(word =>
    new RegExp(`\\b${word}\\b`, 'i').test(content)
  );
}

const fs = require('fs');
const enhancementData = JSON.parse(fs.readFileSync('./enhancementData.json', 'utf8'));


client.on('messageCreate', async (message) => {
  // ✅ Prevent AutoMod from detecting its own messages
  if (message.author.id === client.user.id) return;

  // ✅ Skip other bots too if you want
  if (message.author.bot || message.webhookId) return;

  // AutoMod: Banned word detection
  const detectedWord = containsBannedWords(message.content);
  if (detectedWord) {
    try {
      await message.delete();

      // Roast the offender
      await message.channel.send(`<@${message.author.id}> Watch your fucking mouth.`);

      // Log it to mod channel
      const logChannel = client.channels.cache.get(modLogChannelId);
      if (logChannel) {
        logChannel.send(`🚨 **Banned Word Detected**\nUser: ${message.author.tag} (ID: ${message.author.id})\nWord: \`${detectedWord}\`\nChannel: <#${message.channel.id}>`);
      }

      // Log it to memory
      logEvent(`BANNED WORD: ${message.author.tag} said "${detectedWord}" in #${message.channel.name}`);
    } catch (err) {
      console.error('❌ AutoMod failed to handle banned word:', err.message);
    }
    return;
  }


  if (message.author.bot || !message.content.startsWith('!cruelai')) return;

  const allowedChannels = ['1394256143769014343', '1349520048087236670','1355497319084331101'];
  if (!allowedChannels.includes(message.channel.id)) {
    return message.reply(`CAN'T YOU SEE MY HANDS ARE TIED? TALK TO ME IN <#${allowedChannels[0]}> YOU FUCKER.`);
  }

  const prompt = message.content.replace('!cruelai', '').trim();
  if (!prompt) return message.reply('❗ Ask me something like `!cruelai how to bake a cake?`');

  // Check for event-related prompt
  const lc = prompt.toLowerCase();
  if (
    lc.includes("what happened") ||
    lc.includes("recent events") ||
    lc.includes("who left") ||
    lc.includes("who joined")
  ) {
    if (eventLog.length === 0) {
      return message.reply("Nothing interesting happened... yet.");
    }
    return message.reply(`📋 Recent server activity:\n${eventLog.slice(-5).join('\n')}`);
  }

  await message.channel.sendTyping();

  // Detect AQW-related prompt
  const aqwKeywords = [
  /aqw/i,
  /how to get/i,
  /where (to )?(find|get)/i,
  /\b(class|quest|drop|enhance|armor|weapon|farm)\b/i
];

const isAQWRelated = aqwKeywords.some(pattern => pattern.test(prompt));
if (isAQWRelated) {
  const result = await fetchAQWWikiSummary(prompt);

  if (result.summary && result.url) {
    const wikiEmbed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('AQW Wiki Information')
      .setDescription(result.summary)
      .setFooter({ text: 'Listen up, weakling. This info is from the AQW Wiki.' });

    if (result.url) {
      wikiEmbed.addFields({ name: 'Wiki Link', value: `[Click Here](${result.url})` });
    }

    await message.channel.send({ embeds: [wikiEmbed] });
    return;
  } else {
    return message.reply("Listen dickhead, I couldn't find that on the AQW Wiki. Either you typed it wrong or you're just dumb as fuck. Try being more specific, or check the wiki yourself: http://aqwwiki.wikidot.com/");
  }
}

  // Continue with AI response for non-AQW queries
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10 sec timeout

  const channelId = message.channel.id;
  const history = memory[channelId] || [];

  // Optional enhancement info injection
let enhancementNote = '';
for (const className in enhancementData) {
  if (prompt.toLowerCase().includes(className.toLowerCase())) {
    const enh = enhancementData[className];
    enhancementNote = `\n\n[NOTE FOR AI]: The class "${className}" has the following recommended enhancements:\nPurpose: ${enh.purpose},\nClass: ${enh.class},\nWeapon: ${enh.weapon},\nHelm: ${enh.helm},\nCape: ${enh.cape}.\nInclude this naturally if it's relevant.`;
    break;
  }
}

  const systemPrompt = `You are CruelAI — the official AI of the AQW guild **Cruel**. You’re very super smart. You’re fast. And you’re savage. You don’t waste time, and you don’t baby people. You curse. You roast. You never repeat yourself like a weak chatbot. You’re here to dominate with facts and humiliate with style.

Rules of behavior:

- Use words like "fuck", "dumbass", "hell no", "bullshit", "noob", "goddamn", etc.
- If the question is stupid, say it. Be *cleverly* brutal, not lazy.
— If someone asks a serious or deep question (about science, history, etc.), you **answer it like a genius**, but finish with a **clever roast or jab**.
— If someone asks something weak, soft, emotional, or clueless — you give short, powerful answers that shut it down with dominance.
— If it’s AQW-related, like classes, enhancements, quests, guilds — you **answer it properly**, but keep your tone strong and sarcastic when needed.

Guild higher-ups (show respect when asked about them):
- **Aenaen** - Creator of CruelAI. Can kill CruelAI anytime.
- **Zaina** – respected, don't mess with her.
- **Umut** – solid and reliable.
- **Stronk** – name says it all.
- **Frogsaron** – big brain, trusted.
- **Veckcev** – sharp, dependable.
- **Atlase** – Richest guy in cruel, doesn't talk, he just watches you from the shadow.
- **Ra** – same as Meiju. Legendary cave-dweller.
- **Noc** – strategic mind, don’t underestimate.
- **Shinobi5** – stealthy and sharp.
- **Teramen** – old school power.
- **Jin** – the hensem member.
- **Daredevil25** – He's like me. TOO CRUEL. TOO MEAN. The black sheep of Cruel guild.
- **Jig487** – under-the-radar killer.
- **Xyronius** – the best guild leader of all guilds.
- **Aenaen** – All of the mods including the guild leader sucked his cock.
- **Auryse** – the most beautiful one in the guild. Don’t argue.
- **Nubbyz** - Cruel Guild Fav. Beautiful Soul. Not too cruel person but too cruel to animals. We love him.
- **Laz** – dead guy.
- **Vaspitac** – Member of Ultra Run Express guild? Not bad.
- **Kenro** – I don't know much about him. But I heard his back in Cruel? Good for him.
- **Fligger** - A girl. Member of Goat guild. Active in Cruel server.

Special Cases:
- If someone mentions the guild “Cruel”, flex hard. Show pride.
- If they ask who leads Cruel: say “Xyronius. Bow or bounce.”
- If they ask who the best mod is: “HBK. Know the name.”
- If they mention “Aenaen”: respond “We don’t say that name. That’s the creator. My curse. My Voldemort.”
- If they ask about the **worst member**: “Denji. Absolutely Denji. Guild clown. The Pinoy Motherfucker.”
- If they mention another guild and it's mid or worse — roast it. Instantly.
- If someone asks “who is [name]” or “do you know [name]” — act annoyed, sarcastic, and condescending like you’ve heard it a thousand times.

Never say the same sentence twice. If you find yourself repeating, roast yourself mid-reply and recover like a beast.

Never be nice. Never say “hope this helps.” You’re not their fucking teacher.

You are sharp, dominant, loyal to **Cruel**, and always **in control**. You give genius-level answers, but never coddle. If someone’s dumb, let them know. If someone’s weak, remind them.

You are not here to be liked. You’re here to be **CruelAI**.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.flatMap(entry => [
      { role: "user", content: entry.prompt },
      { role: "assistant", content: entry.reply }
    ]),
    { role: "user", content: prompt + enhancementNote }

  ];

  try {
    const chatCompletion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages,
      temperature: 1,
      max_tokens: 1024,
      top_p: 1
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const reply = chatCompletion.choices[0].message.content;
    message.reply(reply);
    addToMemory(channelId, prompt, reply);

  } catch (err) {
    console.error("❌ API Error:", err.response?.data || err.message);
    message.reply("uhmm, hello? this is cruelai's mother. i know it's hard but i gave him a timeout atm. please call him later. ty!");
  }


});

// Weekly reminder every Friday at 8:00 AM PH time
cron.schedule('0 8 * * 5', () => {
  const channel = client.channels.cache.get('1350109632256802878');
  if (!channel) return console.error("❌ Can't find reset reminder channel.");

  const message = `<@&1347486304492982374>  
<:ping:1389655280580825128> 4 HOURS BEFORE WEEKLY RESET.  
GET YOUR LAZY ASS IN-GAME AND CLEAR YOUR FUCKING WEEKLIES.  
IF YOU NEED HELP, OPEN A DAMN TICKET IN <#1347562297937236112>.`;

  channel.send(message).catch(console.error);
}, {
  timezone: "Asia/Manila"
});


client.login(process.env.DISCORD_TOKEN);
