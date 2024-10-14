# Google Forms to Discord Bot

This bot automatically fetches responses from Google Forms and posts them to designated Discord forum channels. It's designed to streamline the process of tracking form submissions and facilitating discussions around them.

## Features

- Fetches new responses from multiple Google Forms
- Posts new responses to corresponding Discord forum channels
- Supports various question types from Google Forms
- Handles Substrate addresses by creating clickable links
- Implements error handling and logging
- Configurable check intervals and admin role tagging

## Prerequisites

- Node.js (v18.12 or higher recommended)
- A JavaScript package manager (pnpm, bun, yarn, npm)
- A Google Cloud Project with the Google Forms API enabled
- A Discord bot token and application
- Proper permissions for the Discord bot in your server

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/x676f64/google-form-discord-bot.git
   cd google-form-discord-bot
   ```

2. Install dependencies:
   ```
   make install
   ```

3. Set up your environment:
   ```
   make setup
   ```
   Then edit the `.env` file with your configuration.

4. Place your Google Cloud credentials JSON file in the project root and name it according to your `.env` configuration.


## Google Cloud Setup

Before you can use this bot, you need to set up a Google Cloud Project and enable the Google Forms API. Follow these steps:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Enable the Google Forms API:
   - Go to the [Google Forms API page](https://console.cloud.google.com/marketplace/product/google/forms.googleapis.com).
   - Click "Enable" to activate the API for your project.

4. Create a Service Account:
   - In the Google Cloud Console, go to "IAM & Admin" > "Service Accounts".
   - Click "Create Service Account".
   - Give it a name and description, then click "Create".
   - For the role, select "Project" > "Editor" (or a more restrictive role if preferred).
   - Click "Continue" and then "Done".

5. Generate a key for the Service Account:
   - In the Service Accounts list, find the account you just created.
   - Click on the three dots menu (⋮) and select "Manage keys".
   - Click "Add Key" > "Create new key".
   - Choose JSON as the key type and click "Create".
   - Save the downloaded JSON file securely - this is your credential file.

6. Rename the downloaded JSON file to match your `CREDENTIALS_FILENAME` in the `.env` file (default is 'credentials.json') and place it in the project root directory.

Remember to never commit your credentials file to version control. It's recommended to add it to your `.gitignore` file.

## Google Form Setup

After setting up your Google Cloud project, you need to prepare your Google Form for use with this bot. This involves getting the Form ID and adding your service account as a collaborator.

### Getting the Google Form ID

1. Open your Google Form in a web browser.
2. Look at the URL in the address bar. It will look something like this:
   ```
   https://docs.google.com/forms/d/e/1FAIpQLSe****************************************/viewform
   ```
3. The Form ID is the long string of characters between `/d/` and `/viewform`. In this example, it's the part that looks like:
   ```
   1FAIpQLSe****************************************
   ```
4. Copy this ID and use it in your `.env` file for the `FORM_FORUM_MAPPING` configuration.

### Adding the Service Account as a Collaborator

To allow the bot to access your form, you need to add the service account as a collaborator:

1. In your Google Form, click the "More" menu (three vertical dots) in the top right corner.
2. Select "Add collaborators".
3. In the "Invite people" field, enter the email address of your service account. This email address can be found in the JSON credentials file you downloaded earlier, under the `client_email` field.
4. Set the permission to "Editor" to allow the bot to read form responses.
5. Click "Send" to add the service account as a collaborator.

Repeat this process for each form you want the bot to monitor.

## Configuration

[Configuration section remains unchanged, but you might want to add an example for the FORM_FORUM_MAPPING like this:]

- `FORM_FORUM_MAPPING`: A JSON string mapping Google Form IDs to Discord forum channel IDs. For example:
  ```
  {"1FAIpQLSe****************************************":"1234567890123456789"}
  ```
  Where the first string is your Google Form ID, and the second is your Discord forum channel ID.


## Configuration

Edit the `.env` file with the following information:

- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `DISCORD_GUILD_ID`: The ID of your Discord server
- `ADMIN_ROLE_ID`: (Optional) The ID of the admin role to be tagged for new submissions
- `FORM_FORUM_MAPPING`: A JSON string mapping Google Form IDs to Discord forum channel IDs
- `CHECK_INTERVAL`: Interval (in seconds) between checks for new form responses
- `CREDENTIALS_FILENAME`: Filename of your Google Cloud credentials JSON file
- `RESPONSE_TRACK_FILENAME`: Filename to store tracked responses (default: responses.json)
- `ERROR_LOG_FILENAME`: Filename for error logs (default: error.log)
- `COMBINED_LOG_FILENAME`: Filename for combined logs (default: combined.log)
- `PROJECT_NAME_KEYS`: JSON array of keys to identify the project name in form responses

## Docker

This project can be containerized using Docker. A Dockerfile and docker-compose.yml are provided in the root of the project.

### Using docker-compose (Recommended)

1. Make sure you have Docker and docker-compose installed on your system.

2. Create a `.env` file in the project root with your configuration (if you haven't already).

3. Place your `credentials.json` file in the project root.

4. Run the following command in the project root:

   ```bash
   docker-compose up -d
   ```

   This will build the Docker image if it doesn't exist, and start the container in detached mode.

5. To stop the bot, run:

   ```bash
   docker-compose down
   ```

### Manual Docker Commands

If you prefer to use Docker without docker-compose, you can use the following commands:

#### Building the Docker Image

To build the Docker image, run the following command in the project root:

```bash
docker build -t google-forms-discord-bot .
```

#### Running the Docker Container

To run the container, use the following command:

```bash
docker run -v $(pwd)/credentials.json:/app/credentials/credentials.json -v $(pwd)/.env:/app/.env -d google-forms-discord-bot
```

This command does the following:
- Mounts your local `credentials.json` file into the container.
- Mounts your local `.env` file into the container.
- Runs the container in detached mode.

### Environment Variables

All environment variables should be set in your `.env` file. The Docker setup will use this file directly, so there's no need to pass environment variables via the Docker command line.

### Updating the Bot

If you make changes to the bot code:

1. Stop the running container:
   ```bash
   docker-compose down
   ```

2. Rebuild the image and start a new container:
   ```bash
   docker-compose up -d --build
   ```

This will ensure that your container is running the latest version of your code.

[Rest of the README remains unchanged]

## Usage

To start the bot:

```
make start
```

For development:

```
make dev
```

## Maintenance

- To run linting:
  ```
  make lint
  ```

- To run linting and automatically fix issues:
  ```
  make lint-fix
  ```

- To clean up:
  ```
  make clean
  ```

## ESLint Configuration

The project uses ESLint to maintain code quality. The configuration is in `eslint.config.js` and uses the new flat config format. It includes rules for:

- Enforcing consistent code style
- Catching potential errors
- Ensuring best practices

The configuration allows `while (true)` loops, which are used for the bot's main loop.

## Logging

The bot uses Winston for logging. Logs are written to:
- Console
- `error.log` (for error level logs)
- `combined.log` (for all logs)

## Error Handling

The bot implements error handling for various scenarios, including API rate limiting, access issues, and unexpected errors. Check the logs for detailed error information.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the ISC License.

## Support

If you encounter any problems or have any questions, please open an issue in the GitHub repository.