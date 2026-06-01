export function getOpenAiKeyStatus(capabilities, openAiKey = '') {
  const serverKeyConfigured = Boolean(capabilities?.openai?.serverKeyConfigured ?? capabilities?.openai?.keyConfigured);
  const uiKeyConfigured = Boolean(String(openAiKey || '').trim());
  const keySource = serverKeyConfigured && uiKeyConfigured
    ? 'multiple'
    : uiKeyConfigured ? 'ui' : serverKeyConfigured ? 'server' : 'none';
  return {
    keyConfigured: serverKeyConfigured || uiKeyConfigured,
    serverKeyConfigured,
    uiKeyConfigured,
    keySource,
  };
}

export function createOpenAiDiagnosticMetadata(capabilities, openAiKey = '') {
  const status = getOpenAiKeyStatus(capabilities, openAiKey);
  return {
    serverKeyConfigured: status.serverKeyConfigured,
    uiKeyConfigured: status.uiKeyConfigured,
    effectiveKeyConfigured: status.keyConfigured,
    keySource: status.keySource,
  };
}
