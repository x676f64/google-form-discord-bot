require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { Client, GatewayIntentBits } = require('discord.js');
const winston = require('winston');
const { decodeAddress, encodeAddress } = require('@polkadot/util-crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/forms.body.readonly',
];

// Read filenames from .env
const CREDENTIALS_PATH = path.join(process.cwd(), process.env.CREDENTIALS_FILENAME || 'credentials.json');
const RESPONSE_TRACK_FILE = path.join(process.cwd(), process.env.RESPONSE_TRACK_FILENAME || 'responses.json');
const ERROR_LOG_FILE = process.env.ERROR_LOG_FILENAME || 'error.log';
const COMBINED_LOG_FILE = process.env.COMBINED_LOG_FILENAME || 'combined.log';
const CHECK_INTERVAL = (parseInt(process.env.CHECK_INTERVAL) || 86400) * 1000;
const PROJECT_NAME_KEYS = JSON.parse(process.env.PROJECT_NAME_KEYS || '["name of your project"]');

// Parse the FORM_FORUM_MAPPING environment variable
const formForumMapping = JSON.parse(process.env.FORM_FORUM_MAPPING || '{}');

// Get admin role ID from environment variable
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
  return str.length > n ? `${str.slice(0, n - 1)  }…` : str;
}

function getProjectName(response) {
  const projectNameKey = Object.keys(response).find((key) =>
    PROJECT_NAME_KEYS.some((searchString) =>
      key.toLowerCase().includes(searchString.toLowerCase()),
    ),
  );
  return projectNameKey ? response[projectNameKey] : 'Unknown Project';
}

async function sendToDiscord(formattedResponse, formName, formId) {
  try {
    const forumId = formForumMapping[formId];
    if (!forumId) {
      logger.error(`No forum ID mapped for form ID ${formId}`);
      return false; // Return false to indicate failure
    }

    const forum = await discordClient.channels.fetch(forumId);

    if (!forum || forum.type !== 15) {
      logger.error(`Channel with ID ${forumId} is not a forum channel.`);
      return false; // Return false to indicate failure
    }

    const forumName = forum.name;

    const threadName = truncate(
      `${formattedResponse.Submitted} - ${getProjectName(formattedResponse)} `,
      100,
    );
    const message = formatResponseMessage(formName, formattedResponse);

    const thread = await forum.threads.create({
      name: threadName,
      message: {
        content: message,
        flags: 1 << 2, // This sets the SUPPRESS_EMBEDS flag
      },
      autoArchiveDuration: 10080, // Set to maximum value (7 days)
    });

    logger.info(`Successfully created thread ${threadName} in ${forumName}`);

    // Tag admin role in the newly created thread
    if (ADMIN_ROLE_ID) {
      const guild = forum.guild;
      const adminRole = await guild.roles.fetch(ADMIN_ROLE_ID);

      if (adminRole) {
        await thread.send({
          content: `<@&${ADMIN_ROLE_ID}> A new funding request has been received.`,
          allowedMentions: { roles: [ADMIN_ROLE_ID] },
        });
        //logger.info(`Tagged admin role "${adminRole.name}" (${ADMIN_ROLE_ID}) in the new thread in forum "${forumName}".`);
      } else {
        logger.warn(
          `Admin role with ID ${ADMIN_ROLE_ID} not found in the guild. Skipping tagging.`,
        );
      }
    } else {
      logger.warn('No admin role ID provided. Skipping admin role tagging.');
    }

    return true; // Return true to indicate success
  } catch (error) {
    logger.error(`Error sending message to Discord: ${error.message}`);
    if (error.code) {
      logger.error(`Discord API Error Code: ${error.code}`);
    }
    return false; // Return false to indicate failure
  }
}

async function checkNewResponses(auth, formId, trackedResponses) {
  const forms = google.forms({ version: 'v1', auth });
  let formName = formId;
  let formDetails;

  try {
    logger.info(`Checking Google Form API for new responses on form ${formId}`);
    formDetails = await getFormDetails(auth, formId);

    if (formDetails && formDetails.info) {
      formName = formDetails.info.title;
    } else {
      logger.warn(
        `Unable to fetch form details for ${formId}. Using form ID as name.`,
      );
    }

    const response = await forms.forms.responses.list({ formId });
    const responses = response.data.responses || [];

    if (responses.length === 0) {
      logger.info(`No responses found for form "${formName}".`);
      return { updatedResponses: null, newResponsesAdded: false };
    }

    const newResponses = responses.filter(
      (r) =>
        !trackedResponses.some(
          (tr) => tr.Submitted === r.lastSubmittedTime.split('T')[0],
        ),
    );

    if (newResponses.length > 0) {
      logger.info(
        `Found ${newResponses.length} new responses for form "${formName}"`,
      );

      newResponses.sort(
        (a, b) => new Date(b.lastSubmittedTime) - new Date(a.lastSubmittedTime),
      );

      const formattedResponses = newResponses.map((response) =>
        formatResponse(response, formDetails),
      );

      let allThreadsCreated = true;
      for (let i = formattedResponses.length - 1; i >= 0; i--) {
        const threadCreated = await sendToDiscord(
          formattedResponses[i],
          formName,
          formId,
        );
        if (!threadCreated) {
          allThreadsCreated = false;
          break;
        }
      }

      if (allThreadsCreated) {
        return {
          updatedResponses: [...trackedResponses, ...formattedResponses],
          newResponsesAdded: true,
        };
      } else {
        logger.warn(
          `Not all threads were created successfully for form "${formName}". Skipping response tracking update.`,
        );
        return { updatedResponses: null, newResponsesAdded: false };
      }
    } else {
      logger.info(`No new responses for form "${formName}"`);
      return { updatedResponses: null, newResponsesAdded: false };
    }
  } catch (error) {
    handleApiError(error, `Error checking responses for form "${formName}"`);
    return { updatedResponses: null, newResponsesAdded: false };
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
        .map((a) => a.fileName)
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
  } catch (error) {
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

function formatResponseMessage(formName, response) {
  let message = '';

  Object.entries(response).forEach(([key, value]) => {
    if (value && key !== 'Submitted') {
      message += `### ${key}\n`;
      message += `${formatStringWithSubstrateAddresses(value)}\n\n`;
    }
  });

  return message;
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

      // Log forum mappings with forum names
      const forumMappingsWithNames = {};
      for (const [formId, forumId] of Object.entries(formForumMapping)) {
        try {
          const forum = await discordClient.channels.fetch(forumId);
          forumMappingsWithNames[formId] = forum ? forum.name : 'Unknown Forum';
        } catch (error) {
          forumMappingsWithNames[formId] = 'Error fetching forum';
          logger.error(
            `Error fetching forum for formId ${formId}: ${error.message}`,
          );
        }
      }
      logger.info('Forum mappings:', forumMappingsWithNames);

      if (ADMIN_ROLE_ID) {
        const guild = await discordClient.guilds.fetch(
          process.env.DISCORD_GUILD_ID,
        );
        const adminRole = await guild.roles.fetch(ADMIN_ROLE_ID);
        if (adminRole) {
          logger.info(`Admin role set: "${adminRole.name}" (${ADMIN_ROLE_ID})`);
        } else {
          logger.warn(
            `Admin role with ID ${ADMIN_ROLE_ID} not found in the guild.`,
          );
        }
      } else {
        logger.warn(
          'No admin role ID set. Admin role tagging will be skipped.',
        );
      }
    });

    discordClient.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    await discordClient.login(process.env.DISCORD_BOT_TOKEN);

    while (true) {
      let hasChanges = false;
      for (const formId of Object.keys(formForumMapping)) {
        responseTrack[formId] = responseTrack[formId] || [];
        try {
          const { updatedResponses, newResponsesAdded } =
            await checkNewResponses(auth, formId, responseTrack[formId]);
          if (updatedResponses !== null && newResponsesAdded) {
            responseTrack[formId] = updatedResponses;
            hasChanges = true;
          }
        } catch (error) {
          logger.error(`Error processing form ${formId}: ${error.message}`);
        }
      }
      if (hasChanges) {
        await saveResponseTrack(responseTrack);
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
