import { Navigate, Route, Routes } from 'react-router';

import { LoginPage } from './features/auth/LoginPage';
import { AuthenticatedLayout } from './routes/AuthenticatedLayout';
import { BacklogPage } from './routes/BacklogPage';
import { FocusPage } from './routes/FocusPage';
import { InboxPage } from './routes/InboxPage';
import { NotificationsPage } from './routes/NotificationsPage';
import { ReviewPage } from './routes/ReviewPage';
import { SettingsPage } from './routes/SettingsPage';
import { TodayPage } from './routes/TodayPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<LoginPage callback />} />
      <Route element={<AuthenticatedLayout />}>
        <Route path="/today" element={<TodayPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/backlog" element={<BacklogPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/today" />} />
    </Routes>
  );
}
