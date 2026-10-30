export const ASTRA_CAPABILITIES = [
  { id: 'chat', name: 'Astra AI', group: 'Core', icon: 'sparkles', status: 'available', description: 'Chat with the AstraCore neural inference layer.' },
  { id: 'image', name: 'Image Studio', group: 'Create', icon: 'image', status: 'experimental', description: 'Image workflows; provider/model adapters remain optional and are not required by the core.' },
  { id: 'video', name: 'Video Studio', group: 'Create', icon: 'video', status: 'experimental', description: 'Video analysis/workflow adapter architecture.' },
  { id: 'audio', name: 'Audio Studio', group: 'Create', icon: 'audio', status: 'experimental', description: 'Audio transcription and analysis adapter architecture.' },
  { id: 'voice', name: 'Voice Studio', group: 'Create', icon: 'voice', status: 'available', description: 'Speech input and read-aloud controls.' },
  { id: 'document', name: 'Document Studio', group: 'Create', icon: 'document', status: 'experimental', description: 'Document extraction and analysis pipeline.' },
  { id: 'code', name: 'Code Studio', group: 'Work', icon: 'code', status: 'experimental', description: 'Code understanding, debugging and secure-review architecture.' },
  { id: 'data', name: 'Data Studio', group: 'Work', icon: 'data', status: 'experimental', description: 'Structured data-analysis adapter architecture.' },
  { id: 'canvas', name: 'Canvas', group: 'Work', icon: 'canvas', status: 'planned', description: 'Editable document and code workspace.' },
  { id: 'search', name: 'Astra Search', group: 'Research', icon: 'search', status: 'experimental', description: 'Evidence-based web research architecture with citation boundaries.' },
  { id: 'research', name: 'Deep Research', group: 'Research', icon: 'research', status: 'experimental', description: 'Bounded multi-step research planning and synthesis.' },
  { id: 'projects', name: 'Projects', group: 'Workspace', icon: 'folder', status: 'interface-ready', description: 'Persistent chats, files, instructions and memory.' },
  { id: 'memory', name: 'Memory', group: 'Workspace', icon: 'memory', status: 'enabled', description: 'Consent-aware user and conversation memory controls.' },
  { id: 'agents', name: 'Astra Agents', group: 'Workspace', icon: 'agent', status: 'experimental', description: 'Bounded tool-using agents with permissions and skills.' },
  { id: 'tasks', name: 'Tasks & Automation', group: 'Workspace', icon: 'tasks', status: 'planned', description: 'Approved scheduled and repeatable workflows.' },
  { id: 'models', name: 'Model Center', group: 'AI', icon: 'model', status: 'available', description: 'Manage AstraCore model profiles and validated checkpoints.' },
  { id: 'library', name: 'Knowledge Library', group: 'AI', icon: 'library', status: 'enabled', description: 'User-owned knowledge ingestion and hybrid retrieval.' }
];

export function capabilityManifest(models = []) {
  return {
    architecture: 'AstraCore local-first neural workspace',
    providerPolicy: 'AstraCore-owned API and model stack; no commercial LLM is required',
    capabilities: ASTRA_CAPABILITIES,
    models
  };
}
