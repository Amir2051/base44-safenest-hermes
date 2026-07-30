function createNoopClient() {
  const noop = (...args) => Promise.resolve(Array.isArray(args[0]) ? args[0] : (typeof args[0] === 'object' ? args[0] : { data: null }));

  const methodStub = () => ({
    list: async () => [],
    filter: async () => [],
    find: async () => null,
    get: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    updateMany: async () => ({}),
    delete: async () => null,
    subscribe: () => () => {},
  });

  const functionStub = {
    invoke: async () => ({ data: null }),
  };

  const integrationStub = {
    UploadFile: async () => ({ file_url: '' }),
    SendEmail: async () => ({}),
    UploadPrivateFile: async () => ({ file_url: '' }),
    InvokeLLM: async () => ({ data: null }),
  };

  return {
    auth: {
      me: async () => ({ full_name: 'John Doe', phone: '+1 (555) 000-0000', email: 'demo@safenestt.local', role: 'admin', is_admin: true, payment_method_added: true, onboarding_completed: true, job_title: 'Fraud Specialist' }),
      logout: async () => {},
      updateMe: async () => ({}),
    },
    entities: {
      SystemConfig: methodStub(),
      MyCase: methodStub(),
      Case: methodStub(),
      CaseEvidenceFile: methodStub(),
      CaseTask: methodStub(),
      ChatMessage: methodStub(),
      CollaborationWorkspace: methodStub(),
      CollaborativeDocument: methodStub(),
      User: methodStub(),
      CryptoWallet: methodStub(),
      SecureCall: methodStub(),
      SecurityEvent: methodStub(),
      Alert: methodStub(),
      Password: methodStub(),
      Referral: methodStub(),
      Property: methodStub(),
      TitleAlert: methodStub(),
      VerifiedCompany: methodStub(),
    },
    functions: functionStub,
    integrations: {
      Core: integrationStub,
    },
  };
}

const baseNoop = createNoopClient();

function handlerFor(parent) {
  return {
    get(target, prop) {
      if (prop === 'then' || prop === Symbol.toStringTag || prop === Symbol.iterator) return undefined;
      const next = target[prop];
      if (typeof next === 'function') {
        return async (...args) => {
          try { return await next.apply(target, args); } catch { const v = next(); return typeof v === 'function' ? { data: null } : v || { data: null }; }
        };
      }
      if (next && typeof next === 'object' && !Array.isArray(next)) return new Proxy(next, handlerFor(next));
      return async () => ({ data: null });
    },
    has() { return true; },
  };
}

export const base44 = new Proxy(baseNoop, {
  get(target, prop) {
    if (prop === 'then' || prop === Symbol.toStringTag || prop === Symbol.iterator) return undefined;
    const next = target[prop];
    if (typeof next === 'function') {
      return async (...args) => {
        try { return await next.apply(target, args); } catch { return { data: null }; }
      };
    }
    if (next && typeof next === 'object' && !Array.isArray(next)) return new Proxy(next, handlerFor(next));
    if (Array.isArray(next)) return next;
    return next;
  },
});
