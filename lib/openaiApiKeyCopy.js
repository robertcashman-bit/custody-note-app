'use strict';

/** DOM id / settingsFocus token for deep-linking into Settings. */
const OPENAI_KEY_SETTINGS_FOCUS = 'openai-api-key';

const OPENAI_KEY_SETTINGS_PATH_LABEL = 'Settings → Account & cloud';

const OPENAI_KEY_MISSING_USER_MESSAGE =
  'No ChatGPT key saved to your account yet. Add it once in Settings → Account & cloud and it will be kept for all your computers.';

const OPENAI_REENTER_IN_ACCOUNT_SETTINGS =
  'Your saved OpenAI API key could not be read on this computer. Re-enter it in Settings → Account & cloud.';

function openAiKeyMissingResult() {
  return {
    ok: false,
    error: OPENAI_KEY_MISSING_USER_MESSAGE,
    settingsFocus: OPENAI_KEY_SETTINGS_FOCUS,
  };
}

module.exports = {
  OPENAI_KEY_SETTINGS_FOCUS,
  OPENAI_KEY_SETTINGS_PATH_LABEL,
  OPENAI_KEY_MISSING_USER_MESSAGE,
  OPENAI_REENTER_IN_ACCOUNT_SETTINGS,
  openAiKeyMissingResult,
};
