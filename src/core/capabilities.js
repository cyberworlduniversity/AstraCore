export const ASTRA_CAPABILITIES = [
  { id: 'chat', name: 'Astra AI', group: 'Core', icon: 'sparkles', status: 'available', description: 'Chat with the AstraCore neural inference layer.' },
  { id: 'image', name: 'Image Studio', group: 'Create', icon: 'image', status: 'interface-ready', description: 'Image generation, editing and vision workflows.' },
  { id: 'video', name: 'Video Studio', group: 'Create', icon: 'video', status: 'interface-ready', description: 'Video creation, analysis and media workflows.' },
  { id: 'audio', name: 'Audio Studio', group: 'Create', icon: 'audio', status: 'interface-ready', description: 'Audio generation, transcription and analysis workflows.' },
  { id: 'voice', name: 'Voice Studio', group: 'Create', icon: 'voice', status: 'available', description: 'Speech input and AstraCore read-aloud controls.' },
  { id: 'document', name: 'Document Studio', group: 'Create', icon: 'document', status: 'interface-ready', description: 'Document upload, preview and analysis pipeline.' },
  { id: 'code', name: 'Code Studio', group: 'Work', icon: 'code', status: 'available', description: 'Coding, debugging and software-engineering workflows.' },
  { id: 'data', name: 'Data Studio', group: 'Work', icon: 'data', status: 'planned', description: 'Structured data analysis and chart workflows.' },
  { id: 'canvas', name: 'Canvas', group: 'Work', icon: 'canvas', status: 'planned', description: 'Editable document and code workspace.' },
  { id: 'search', name: 'Astra Search', group: 'Research', icon: 'search', status: 'planned', description: 'Evidence-based web search with citations.' },
  { id: 'research', name: 'Deep Research', group: 'Research', icon: 'research', status: 'planned', description: 'Multi-step research planning and synthesis.' },
  { id: 'projects', name: 'Projects', group: 'Workspace', icon: 'folder', status: 'interface-ready', description: 'Persistent chats, files, instructions and memory.' },
  { id: 'memory', name: 'Memory', group: 'Workspace', icon: 'memory', status: 'interface-ready', description: 'User, project and conversation memory controls.' },
  { id: 'agents', name: 'Astra Agents', group: 'Workspace', icon: 'agent', status: 'interface-ready', description: 'Tool-using agents with permissions and skills.' },
  { id: 'tasks', name: 'Tasks & Automation', group: 'Workspace', icon: 'tasks', status: 'planned', description: 'Approved scheduled and repeatable workflows.' },
  { id: 'models', name: 'Model Center', group: 'AI', icon: 'model', status: 'available', description: 'Manage AstraCore model profiles and checkpoints.' },
  { id: 'library', name: 'Knowledge Library', group: 'AI', icon: 'library', status: 'planned', description: 'Searchable user-owned knowledge and source files.' }
];

export function capabilityManifest(models = []) {
  return {
    architecture: 'AstraCore local-first neural workspace',
    providerPolicy: 'AstraCore-owned API and model stack; no commercial LLM is required',
    capabilities: ASTRA_CAPABILITIES,
    models
  };
}
