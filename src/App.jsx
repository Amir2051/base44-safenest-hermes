import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import PrivacyAdvisor from './pages/PrivacyAdvisor';
import UserExport from './pages/UserExport';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import CustomLogin from '@/pages/CustomLogin';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // The custom auth service is now the source of identity. Fail closed if it is unavailable.
  if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;
  if (authError?.type === 'unknown') {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="max-w-lg rounded-xl border bg-white p-8 shadow-sm"><h1 className="text-xl font-semibold text-slate-900">Authentication service unavailable</h1><p className="mt-3 text-sm text-slate-600">SafeNestT could not verify your session. Your data has not been changed. Please try again shortly.</p><button className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-white" onClick={() => window.location.reload()}>Retry</button></div></div>;
  }
  if (!isAuthenticated) return <CustomLogin />;

  // Render the main app
  return (
    <LayoutWrapper currentPageName={mainPageKey}>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/login" element={<CustomLogin />} />
        {Object.entries(Pages).map(([path, Page]) => (
          <Route key={path} path={`/${path}`} element={<Page />} />
        ))}
        <Route path="/PrivacyAdvisor" element={<LayoutWrapper currentPageName="PrivacyAdvisor"><PrivacyAdvisor /></LayoutWrapper>} />
        <Route path="/UserExport" element={<LayoutWrapper currentPageName="UserExport"><UserExport /></LayoutWrapper>} />
        <Route path="/admin" element={<LayoutWrapper currentPageName="AdminDashboard"><Pages.AdminDashboard /></LayoutWrapper>} />
        <Route path="/admin-dashboard" element={<LayoutWrapper currentPageName="AdminDashboard"><Pages.AdminDashboard /></LayoutWrapper>} />
        <Route path="/admin-users" element={<LayoutWrapper currentPageName="AdminUserApprovals"><Pages.AdminUserApprovals /></LayoutWrapper>} />
        <Route path="/admin-roles" element={<LayoutWrapper currentPageName="AdminUserApprovals"><Pages.AdminUserApprovals /></LayoutWrapper>} />
        <Route path="/tasks" element={<LayoutWrapper currentPageName="Cases"><Pages.Cases /></LayoutWrapper>} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </LayoutWrapper>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App