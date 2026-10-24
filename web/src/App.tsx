import { Link, Route, Routes } from 'react-router';
import { Header } from './components/Header';
import { CartDrawer } from './features/cart/CartDrawer';
import { RequireAuth } from './features/auth/RequireAuth';
import { ShopPage } from './pages/ShopPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CheckoutPage } from './pages/CheckoutPage';
import { AccountPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/AccountPages';
import { RiderPage } from './pages/RiderPage';
import { CreditsPage } from './pages/CreditsPage';
import { OrderDetailPage, OrdersPage } from './pages/OrderPages';
import {
  AdminInventoryPage, AdminLayout, AdminOrdersPage, AdminReportsPage, AdminRidersPage, AdminSlotsPage,
} from './pages/admin/AdminPages';

export function App() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<ShopPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="/rider" element={<RequireAuth rider><RiderPage /></RequireAuth>} />
          <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="/credits" element={<CreditsPage />} />
          <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
          <Route path="/orders/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
            <Route index element={<AdminOrdersPage />} />
            <Route path="inventory" element={<AdminInventoryPage />} />
            <Route path="slots" element={<AdminSlotsPage />} />
            <Route path="riders" element={<AdminRidersPage />} />
            <Route path="reports" element={<AdminReportsPage />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="page narrow">
                <h1>Page not found</h1>
                <p className="muted">That address doesn’t match any page in QuickKart.</p>
                <Link className="btn btn-dark" to="/">Go to the shop</Link>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer muted">
        QuickKart is a student project. <Link to="/credits">Photo credits</Link>
      </footer>
      <CartDrawer />
    </>
  );
}
