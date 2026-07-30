const createNoopClient = () => ({
  auth: {
    me: () => Promise.resolve({ full_name: "John Doe", phone: "+1 (555) 000-0000", email: "demo@safenestt.local", role: "admin", is_admin: true, payment_method_added: true, onboarding_completed: true }),
    logout: () => Promise.resolve(),
    updateMe: () => Promise.resolve({}),
  },
  entities: {
    Alert: { filter: () => Promise.resolve([]), list: () => Promise.resolve([]) },
    Password: { list: () => Promise.resolve([]) },
    Referral: { list: () => Promise.resolve([]) },
    Property: { list: () => Promise.resolve([]) },
    TitleAlert: { list: () => Promise.resolve([]) },
    Case: { filter: () => Promise.resolve([]), list: () => Promise.resolve([]) },
    SystemConfig: { list: () => Promise.resolve([]) },
  },
  functions: {
    invoke: () => Promise.resolve({ data: null }),
  },
  integrations: {
    Core: {
      UploadFile: () => Promise.resolve({ file_url: "" }),
      SendEmail: () => Promise.resolve({}),
    },
  },
});

export const base44 = createNoopClient();
