require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const winston = require('winston');
const { decodeAddress, encodeAddress } = require('@polkadot/util-crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/forms.body.readonly',
];

const CREDENTIALS_PATH = path.join(process.cwd(), process.env.CREDENTIALS_FILENAME || 'credentials.json');
const RESPONSE_TRACK_FILE = path.join(process.cwd(), process.env.RESPONSE_TRACK_FILENAME || 'responses.json');
const ERROR_LOG_FILE = process.env.ERROR_LOG_FILENAME || 'error.log';
const COMBINED_LOG_FILE = process.env.COMBINED_LOG_FILENAME || 'combined.log';
const CHECK_INTERVAL = (parseInt(process.env.CHECK_INTERVAL) || 86400) * 1000;
const PROJECT_NAME_KEYS = JSON.parse(process.env.PROJECT_NAME_KEYS || '["name of your project"]');
const FORM_FORUM_MAPPING = JSON.parse(process.env.FORM_FORUM_MAPPING || '{}');
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    }),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: ERROR_LOG_FILE, level: 'error' }),
    new winston.transports.File({ filename: COMBINED_LOG_FILE }),
  ],
});

async function authorize() {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
  } catch (error) {
    logger.error(`Error in authorize: ${error.message}`);
    throw error;
  }
}

async function getFormDetails(auth, formId) {
  try {
    const forms = google.forms({ version: 'v1', auth });
    const response = await forms.forms.get({ formId });
    return response.data;
  } catch (error) {
    handleApiError(error, `Error fetching form details for ${formId}`);
    return null;
  }
}



async function getAdminRole(guild) {
  if (!ADMIN_ROLE_ID) {
    logger.warn('No admin role ID or name provided. Admin role tagging will be skipped.');
    return null;
  }

  try {
    let adminRole;
    if (/^\d+$/.test(ADMIN_ROLE_ID)) {
      // If it's a numeric string, treat it as an ID
      adminRole = await guild.roles.fetch(ADMIN_ROLE_ID);
    } else {
      // If it's not numeric, treat it as a name (case-insensitive)
      const lowerCaseRoleName = ADMIN_ROLE_ID.toLowerCase();
      adminRole = guild.roles.cache.find(role => role.name.toLowerCase() === lowerCaseRoleName);
    }

    if (adminRole) {
      logger.debug(`Admin role set: "${adminRole.name}" (${adminRole.id})`);
      return adminRole;
    } else {
      logger.warn(`Admin role "${ADMIN_ROLE_ID}" not found in the guild.`);
      return null;
    }
  } catch (error) {
    logger.error(`Error fetching admin role: ${error.message}`);
    return null;
  }
}

function splitIntoQuestions(message) {
  return message.split('## ').filter(q => q.trim() !== '').map(q => `### ${  q.trim()}`);
}

function createButton(responseUrl) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('View Full Response')
        .setURL(responseUrl),
    );
}

async function loadResponseTrack() {
  try {
    const data = await fs.readFile(RESPONSE_TRACK_FILE, 'utf8');
    return data.trim() ? JSON.parse(data) : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('No existing response track found. Creating a new one.');
      await saveResponseTrack({});
      return {};
    }
    if (error instanceof SyntaxError) {
      logger.warn('Invalid JSON in response track file. Creating a new one.');
      await saveResponseTrack({});
      return {};
    }
    logger.error(`Error reading response track: ${error.message}`);
    return {};
  }
}

async function saveResponseTrack(track) {
  try {
    await fs.writeFile(
      RESPONSE_TRACK_FILE,
      JSON.stringify(track, null, 2),
      'utf8',
    );
    logger.info(`Successfully wrote to ${RESPONSE_TRACK_FILE}`);
  } catch (error) {
    logger.error(`Error writing to ${RESPONSE_TRACK_FILE}: ${error.message}`);
  }
}

function truncate(str, n) {
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function getProjectName(response) {
  const projectNameKey = Object.keys(response).find((key) =>
    PROJECT_NAME_KEYS.some((searchString) =>
      key.toLowerCase().includes(searchString.toLowerCase()),
    ),
  );
  return projectNameKey ? response[projectNameKey] : 'Unknown Project';
}

function getTotalCost(response) {
  const costKeys = ['total cost', 'budget', 'funding amount', 'requested amount'];
  for (const [key, value] of Object.entries(response)) {
    if (costKeys.some(costKey => key.toLowerCase().includes(costKey))) {
      // Truncate the value to a reasonable length
      const truncatedValue = truncateCost(value);
      return truncatedValue;
    }
  }
  return 'Cost not found';
}

function truncateCost(value) {
  // Remove leading/trailing whitespace
  let trimmedValue = value.trim();
  
  // If the value is longer than 20 characters, truncate it
  if (trimmedValue.length > 20) {
    // Try to find a sensible place to truncate
    let truncateIndex = 20;
    while (truncateIndex > 0 && !/[\s,.]/.test(trimmedValue[truncateIndex - 1])) {
      truncateIndex--;
    }
    // If we couldn't find a good break point, just use 20
    if (truncateIndex === 0) {
      truncateIndex = 20;
    }
    
    trimmedValue = `${trimmedValue.substring(0, truncateIndex)  }...`;
  }
  
  return trimmedValue;
}

async function createOrFetchTag(forum, tagName) {
  try {
    const existingTags = await forum.availableTags;
    let tag = existingTags.find(t => t.name === tagName);

    if (!tag) {
      const newTags = [...existingTags, { name: tagName }];
      await forum.setAvailableTags(newTags);
      tag = newTags.find(t => t.name === tagName);
      logger.info(`Created new tag "${tagName}" for forum ${forum.name}`);
    }

    if (!tag || !tag.id) {
      logger.error(`Failed to create or fetch tag "${tagName}" with a valid ID`);
      return null;
    }
    return tag;
  } catch (error) {
    logger.error(`Error creating/fetching tag "${tagName}": ${error.message}`);
    return null;
  }
}


async function sendToDiscord(formattedResponse, formId, trackedResponses) {
  let initialMessage = '';

  try {
    const forumMapping = FORM_FORUM_MAPPING[formId];
    let forumId, customForumName, tagName, responseUrl;

    if (Array.isArray(forumMapping)) {
      [forumId, customForumName, responseUrl] = forumMapping;
      tagName = customForumName;
    } else {
      forumId = forumMapping;
    }

    logger.info(`Processing form ${formId} with mapping: ${JSON.stringify(forumMapping)}`);

    if (!forumId) {
      logger.error(`No forum ID mapped for form ID ${formId}`);
      return false;
    }
  

    if (!responseUrl) {
      logger.error(`No response URL provided for form ID ${formId}`);
      return false;
    }

    const forum = await discordClient.channels.fetch(forumId);

    if (!forum || forum.type !== ChannelType.GuildForum) {
      logger.error(`Channel with ID ${forumId} is not a forum channel.`);
      return false;
    }

    const forumName = customForumName || forum.name;

    const projectName = getProjectName(formattedResponse);
    const totalCost = getTotalCost(formattedResponse);

    const threadName = truncate(
      `${formattedResponse.Submitted} - ${projectName} - ${totalCost}`,
      100,
    );
    const formattedMessage = formatResponseMessage(formattedResponse, responseUrl);
    const message = formattedMessage.content;
    const components = formattedMessage.components;

    const appliedTags = [];
    if (tagName) {
      const tag = await createOrFetchTag(forum, tagName);
      if (tag && tag.id) {
        appliedTags.push(tag.id);
      }
    }

    const questions = splitIntoQuestions(message);

    const remainingQuestions = [];
    const maxLength = 2000 - JSON.stringify(createButton(responseUrl)).length;

    for (const question of questions) {
      if (initialMessage.length + question.length <= maxLength) {
        initialMessage += `${question}\n\n`;
      } else {
        remainingQuestions.push(question);
      }
    }

    // Create thread with as many questions as possible and embed
    const thread = await forum.threads.create({
      name: threadName,
      message: {
        content: initialMessage.trim(),
        flags: 1 << 2, // This sets the SUPPRESS_EMBEDS flag
        components,
      },
      appliedTags,
      autoArchiveDuration: 10080, // Set to maximum value (7 days)
    });

    logger.info(`Successfully created thread ${threadName} in ${forumName} with tags: ${appliedTags.join(', ')}`);

    // Send remaining questions as separate messages
    for (const question of remainingQuestions) {
      await thread.send({ 
        content: question,
        flags: 1 << 2,
      });
    }

    // Tag admin role in the newly created thread
    const guild = forum.guild;
    const adminRole = await getAdminRole(guild);

    if (adminRole) {
      await thread.send({
        content: `<@&${adminRole.id}> A new funding request has been received.`,
        allowedMentions: { roles: [adminRole.id] },
      });
    } else {
      logger.warn('Admin role not found or not set. Skipping admin role tagging.');
    }

    // Update and save response track
    trackedResponses[formId] = trackedResponses[formId] || [];
    trackedResponses[formId].push(formattedResponse);
    await saveResponseTrack(trackedResponses);

    return true;
  } catch (error) {
    logger.error(`Error sending message to Discord: ${error.message}`);
    if (error.code) {
      logger.error(`Discord API Error Code: ${error.code}`);
    }
    return false;
  }
}

async function checkNewResponses(auth, formId, responseTrack) {
  const forms = google.forms({ version: 'v1', auth });
  let formName = formId;
  let formDetails;

  try {
    logger.info(`Checking Google Form API for new responses on form ${formId}`);
    formDetails = await getFormDetails(auth, formId);

    if (formDetails && formDetails.info) {
      formName = formDetails.info.title;
    } else {
      logger.warn(`Unable to fetch form details for ${formId}. Using form ID as name.`);
    }

    const response = await forms.forms.responses.list({ formId });
    const responses = response.data.responses || [];

    if (responses.length === 0) {
      logger.info(`No responses found for form "${formName}".`);
      return false;
    }

    const trackedResponses = responseTrack[formId] || [];
    const newResponses = responses.filter(
      (r) => !trackedResponses.some((tr) => tr.Submitted === r.lastSubmittedTime.split('T')[0]),
    );

    if (newResponses.length > 0) {
      logger.info(`Found ${newResponses.length} new responses for form "${formName}"`);

      // Sort new responses by submission time (oldest first)
      newResponses.sort((a, b) => new Date(a.lastSubmittedTime) - new Date(b.lastSubmittedTime));

      for (const response of newResponses) {
        const formattedResponse = formatResponse(response, formDetails);
        const threadCreated = await sendToDiscord(formattedResponse, formId, responseTrack);

        if (!threadCreated) {
          logger.warn(`Failed to create thread for response submitted on ${formattedResponse.Submitted}`);
        }
      }

      return true;
    } else {
      logger.info(`No new responses for form "${formName}"`);
      return false;
    }
  } catch (error) {
    handleApiError(error, `Error checking responses for form "${formName}"`);
    return false;
  }
}


function formatResponse(response, formDetails) {
  const questions = formDetails
    ? formDetails.items.reduce((acc, item) => {
      if (item.questionItem && item.questionItem.question) {
        acc[item.questionItem.question.questionId] = item.title;
      }
      return acc;
    }, {})
    : {};

  const formattedResponse = {
    Submitted: response.lastSubmittedTime.split('T')[0], // This will give us just the date part
  };

  Object.entries(response.answers).forEach(([questionId, answer]) => {
    let answerValue = '';
    if (answer.textAnswers) {
      answerValue = answer.textAnswers.answers.map((a) => a.value).join(', ');
    } else if (answer.fileUploadAnswers) {
      answerValue = answer.fileUploadAnswers.answers
        .map((a) => {
          const fileId = a.fileId;
          const fileName = a.fileName;
          const fileUrl = `https://drive.google.com/open?id=${fileId}`;
          logger.debug(`Processing file upload: ${fileName} (ID: ${fileId})`);
          return `[${fileName}](${fileUrl})`;
        })
        .join(', ');
    } else if (answer.scaleAnswers) {
      answerValue = answer.scaleAnswers.answers.map((a) => a.value).join(', ');
    } else if (answer.dateAnswers) {
      answerValue = answer.dateAnswers.answers
        .map((a) => `${a.year}-${a.month}-${a.day}`)
        .join(', ');
    } else if (answer.timeAnswers) {
      answerValue = answer.timeAnswers.answers
        .map((a) => `${a.hours}:${a.minutes}:${a.seconds}`)
        .join(', ');
    } else if (answer.choiceAnswers) {
      answerValue = answer.choiceAnswers.answers.map((a) => a.value).join(', ');
    } else {
      answerValue = 'Unsupported answer type';
    }

    const questionText = questions[questionId] || `Question ${questionId}`;
    formattedResponse[questionText] = answerValue;
  });

  return formattedResponse;
}


function isValidSubstrateAddress(address) {
  try {
    encodeAddress(decodeAddress(address));
    return true;
  } catch {
    return false;
  }
}

function formatStringWithSubstrateAddresses(str) {
  // This regex looks for strings that could be Substrate addresses
  const potentialAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{47,48}\b/g;

  return str.replace(potentialAddressRegex, (match) => {
    if (isValidSubstrateAddress(match)) {
      return `[${match}](https://polkadot.subscan.io/account/${match})`;
    }
    return match;
  });
}

function formatResponseMessage(response, responseUrl) {
  let message = '';
  const buttons = [];

  Object.entries(response).forEach(([key, value]) => {
    if (value && key !== 'Submitted') {
      const lowerKey = key.toLowerCase();
      
      if (!PROJECT_NAME_KEYS.some(nameKey => lowerKey.includes(nameKey.toLowerCase()))) {
        if (lowerKey.includes('website')) {
          let url = value;
          if (!url.match(/^https?:\/\//i)) {
            url = `https://${  url}`;
          }
          buttons.push(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel('Website')
              .setURL(url),
          );
        } else if (value.startsWith('[') && value.includes('](https://drive.google.com/open?id=')) {
          const [fileName, fileUrl] = value.slice(1, -1).split('](');
          buttons.push(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(`${fileName.length > 20 ? `${fileName.substring(0, 17)  }...` : fileName}`)
              .setURL(fileUrl),
          );
        } else {
          message += `## ${key}\n`;
          message += `${formatStringWithSubstrateAddresses(value)}\n\n`;
        }
      }
    }
  });

  if (responseUrl) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Spreadsheet')
        .setURL(responseUrl)
    );
  }

  const actionRows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder()
      .addComponents(buttons.slice(i, i + 5));
    actionRows.push(row);
  }

  return { content: message.trim(), components: actionRows };
}

function handleApiError(error, context) {
  logger.error(`${context}: ${error.message}`);
  if (error.response) {
    const { status, data } = error.response;
    logger.error(`Status: ${status}, Data: ${JSON.stringify(data)}`);

    switch (status) {
    case 429:
      logger.warn('Rate limit exceeded. Implementing exponential backoff...');
      // Implement exponential backoff logic here
      break;
    case 403:
      logger.error(
        'Access forbidden. Check API credentials and permissions.',
      );
      break;
    case 500:
      logger.error(
        'Internal server error from Google API. Retrying later...',
      );
      break;
    default:
      logger.error(`Unexpected error status: ${status}`);
    }
  }
}

async function main() {
  try {
    const auth = await authorize();
    const responseTrack = await loadResponseTrack();
    logger.info('Initial responseTrack:', responseTrack);

    discordClient.once('ready', async () => {
      logger.info('Discord bot is ready!');
      logger.info(`Logged in as ${discordClient.user.tag}`);
      logger.info(`Serving in guild: ${process.env.DISCORD_GUILD_ID}`);

      // Log forum mappings with forum names and tags
      const forumMappingsWithNames = {};
      for (const [formId, mapping] of Object.entries(FORM_FORUM_MAPPING)) {
        try {
          let forumId, customName, tagName;
          if (Array.isArray(mapping)) {
            [forumId, customName, tagName] = mapping;
          } else {
            forumId = mapping;
          }

          const forum = await discordClient.channels.fetch(forumId);
          forumMappingsWithNames[formId] = {
            name: customName || (forum ? forum.name : 'Unknown Forum'),
            tagName: tagName || 'No Tag',
          };
        } catch (error) {
          forumMappingsWithNames[formId] = { name: 'Error fetching forum', tagName: 'Error' };
          logger.error(
            `Error fetching forum for formId ${formId}: ${error.message}`,
          );
        }
      }
      logger.info('Forum mappings:', JSON.stringify(forumMappingsWithNames, null, 2));

      const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const adminRole = await getAdminRole(guild);
      if (!adminRole) {
        logger.warn('Admin role not found or not set. Admin role tagging will be skipped.');
      }
    });

    discordClient.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    await discordClient.login(process.env.DISCORD_BOT_TOKEN);

    while (true) {
      for (const formId of Object.keys(FORM_FORUM_MAPPING)) {
        try {
          await checkNewResponses(auth, formId, responseTrack);
        } catch (error) {
          logger.error(`Error processing form ${formId}: ${error.message}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
    }
  } catch (error) {
    logger.error(`Fatal error in main: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(`Unhandled error in main: ${error.message}`);
  process.exit(1);
});