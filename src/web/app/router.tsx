import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, createHashRouter, Outlet, ScrollRestoration, useLocation, type RouteObject } from 'react-router';
import { AppShell } from '../components/layout/AppShell';
import { Spinner } from '../components/ui/Feedback';
import { AuthProvider } from './auth';

const page = (loader: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> => lazy(loader);

const Discover = page(() => import('../screens/Discover'));
const SearchPage = page(() => import('../screens/Search'));
const EventPage = page(() => import('../screens/EventPage'));
const SeatSelect = page(() => import('../screens/SeatSelect'));
const QueuePage = page(() => import('../screens/Queue'));
const Checkout = page(() => import('../screens/Checkout'));
const OrderPage = page(() => import('../screens/OrderPage'));
const Tickets = page(() => import('../screens/Tickets'));
const TicketDetail = page(() => import('../screens/TicketDetail'));
const TransferClaim = page(() => import('../screens/TransferClaim'));
const Login = page(() => import('../screens/Login'));
const Profile = page(() => import('../screens/Profile'));
const ProfileEdit = page(() => import('../screens/ProfileEdit'));
const LoginMethods = page(() => import('../screens/LoginMethods'));
const NotificationSettings = page(() => import('../screens/NotificationSettings'));
const PurchaseHistory = page(() => import('../screens/PurchaseHistory'));
const Favorites = page(() => import('../screens/Favorites'));
const Privacy = page(() => import('../screens/Privacy'));
const Help = page(() => import('../screens/Help'));
const Notifications = page(() => import('../screens/Notifications'));
const OrganizerPublic = page(() => import('../screens/OrganizerPublic'));
const Legal = page(() => import('../screens/Legal'));
const NotFound = page(() => import('../screens/NotFound'));
const DemoPay = page(() => import('../screens/DemoPay'));
const DemoInbox = page(() => import('../screens/DemoInbox'));

const OrgShell = page(() => import('../organizer/OrgShell'));
const OrgHome = page(() => import('../organizer/OrgHome'));
const OrgApply = page(() => import('../organizer/Apply'));
const OrgDashboard = page(() => import('../organizer/Dashboard'));
const OrgEvents = page(() => import('../organizer/EventsList'));
const OrgEventEditor = page(() => import('../organizer/EventEditor'));
const OrgEventHub = page(() => import('../organizer/EventHub'));
const OrgTicketTypes = page(() => import('../organizer/TicketTypesEditor'));
const OrgSeatMap = page(() => import('../organizer/SeatMapEditor'));
const OrgOrders = page(() => import('../organizer/OrdersList'));
const OrgAttendees = page(() => import('../organizer/Attendees'));
const OrgDiscounts = page(() => import('../organizer/Discounts'));
const OrgCheckin = page(() => import('../organizer/CheckinSetup'));
const OrgSettlement = page(() => import('../organizer/Settlement'));
const OrgTeam = page(() => import('../organizer/Team'));
const OrgSettings = page(() => import('../organizer/OrgSettings'));

const ScannerLogin = page(() => import('../scanner/ScannerLogin'));
const Scanner = page(() => import('../scanner/Scanner'));

const AdminShell = page(() => import('../admin/AdminShell'));
const AdminOverview = page(() => import('../admin/Overview'));
const AdminOrganizers = page(() => import('../admin/Organizers'));
const AdminEvents = page(() => import('../admin/Events'));
const AdminUsers = page(() => import('../admin/Users'));
const AdminSettings = page(() => import('../admin/Settings'));

function PageFallback() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Spinner size={28} />
    </div>
  );
}

function el(Component: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  );
}

/** Moves focus to the new screen's content for screen-reader users after navigation. */
function RouteFocus() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const main = document.getElementById('innhold');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  }, [location.pathname]);
  return null;
}

function Root() {
  return (
    <AuthProvider>
      <ScrollRestoration getKey={(location) => location.pathname} />
      <RouteFocus />
      <Outlet />
    </AuthProvider>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: el(Discover) },
          { path: 'sok', element: el(SearchPage) },
          { path: 'e/:slug', element: el(EventPage) },
          { path: 'a/:slug', element: el(OrganizerPublic) },
          { path: 'billetter', element: el(Tickets) },
          { path: 'profil', element: el(Profile) },
          { path: 'profil/rediger', element: el(ProfileEdit) },
          { path: 'profil/innlogging', element: el(LoginMethods) },
          { path: 'profil/varsler', element: el(NotificationSettings) },
          { path: 'profil/kjop', element: el(PurchaseHistory) },
          { path: 'profil/favoritter', element: el(Favorites) },
          { path: 'profil/personvern', element: el(Privacy) },
          { path: 'hjelp', element: el(Help) },
          { path: 'varsler', element: el(Notifications) },
          { path: 'vilkar', element: el(Legal) },
          { path: 'personvernerklaering', element: el(Legal) },
          { path: 'demo/innboks', element: el(DemoInbox) },
        ],
      },
      { path: 'e/:slug/seter', element: el(SeatSelect) },
      { path: 'e/:slug/ko', element: el(QueuePage) },
      { path: 'kasse/:orderId', element: el(Checkout) },
      { path: 'ordre/:orderId', element: el(OrderPage) },
      { path: 'billetter/:ticketId', element: el(TicketDetail) },
      { path: 'overfor/:token', element: el(TransferClaim) },
      { path: 'logg-inn', element: el(Login) },
      { path: 'demo/betal/:ref', element: el(DemoPay) },
      { path: 'arrangor', element: el(OrgHome) },
      { path: 'arrangor/ny', element: el(OrgApply) },
      {
        path: 'arrangor/:orgId',
        element: el(OrgShell),
        children: [
          { index: true, element: el(OrgDashboard) },
          { path: 'arrangementer', element: el(OrgEvents) },
          { path: 'arrangementer/ny', element: el(OrgEventEditor) },
          { path: 'arrangementer/:eventId', element: el(OrgEventHub) },
          { path: 'arrangementer/:eventId/rediger', element: el(OrgEventEditor) },
          { path: 'arrangementer/:eventId/billettyper', element: el(OrgTicketTypes) },
          { path: 'arrangementer/:eventId/salkart', element: el(OrgSeatMap) },
          { path: 'arrangementer/:eventId/ordre', element: el(OrgOrders) },
          { path: 'arrangementer/:eventId/deltakere', element: el(OrgAttendees) },
          { path: 'arrangementer/:eventId/rabattkoder', element: el(OrgDiscounts) },
          { path: 'arrangementer/:eventId/innsjekk', element: el(OrgCheckin) },
          { path: 'oppgjor', element: el(OrgSettlement) },
          { path: 'team', element: el(OrgTeam) },
          { path: 'innstillinger', element: el(OrgSettings) },
        ],
      },
      { path: 'skann', element: el(ScannerLogin) },
      { path: 'skann/:eventId', element: el(Scanner) },
      {
        path: 'admin',
        element: el(AdminShell),
        children: [
          { index: true, element: el(AdminOverview) },
          { path: 'arrangorer', element: el(AdminOrganizers) },
          { path: 'arrangementer', element: el(AdminEvents) },
          { path: 'brukere', element: el(AdminUsers) },
          { path: 'innstillinger', element: el(AdminSettings) },
        ],
      },
      { path: '*', element: el(NotFound) },
    ],
  },
];

export function createAppRouter(kind: 'browser' | 'hash') {
  return kind === 'hash' ? createHashRouter(routes) : createBrowserRouter(routes);
}
