import { createBrowserRouter } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Landing } from '../pages/Landing';
import { NotFound } from '../pages/NotFound';
import { Profile } from '../pages/Profile';
import { RoomPage } from '../pages/Room';
import { Rooms } from '../pages/Rooms';
import { Settings } from '../pages/Settings';
import { SignIn } from '../pages/SignIn';
import { Welcome } from '../pages/Welcome';
import { GuestOnly, RequireOnboarded, RequireSession } from './guards';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/', element: <Landing /> },
          { path: '/signin', element: <SignIn /> },
        ],
      },
      {
        element: <RequireSession />,
        children: [{ path: '/welcome', element: <Welcome /> }],
      },
      {
        element: <RequireOnboarded />,
        children: [
          { path: '/rooms', element: <Rooms /> },
          { path: '/r/:roomId', element: <RoomPage /> },
          { path: '/u/:username', element: <Profile /> },
          { path: '/settings', element: <Settings /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
