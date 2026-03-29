import { Routes } from '@angular/router';
import { authOnlyGuard, landingGuard, roleGuard } from './core/auth.guard';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';
import { ForgotPasswordComponent } from './features/auth/forgot-password.component';
import { ResetPasswordComponent } from './features/auth/reset-password.component';
import { ListingBrowseComponent } from './features/listings/listing-browse.component';
import { ListingCreateComponent } from './features/listings/listing-create.component';
import { ListingDetailComponent } from './features/listings/listing-detail.component';
import { MyListingsComponent } from './features/listings/my-listings.component';
import { UploadComponent } from './features/upload/upload.component';
import { OrderListComponent } from './features/orders/order-list.component';
import { OrderDetailComponent } from './features/orders/order-detail.component';
import { PaymentCaptureComponent } from './features/orders/payment-capture.component';
import { ReviewFormComponent } from './features/reviews/review-form.component';
import { ReviewListComponent } from './features/reviews/review-list.component';
import { SellerStorefrontComponent } from './features/storefront/seller-storefront.component';
import { ModerationQueueComponent } from './features/moderation/moderation-queue.component';
import { ModerationDecisionComponent } from './features/moderation/moderation-decision.component';
import { AppealQueueComponent } from './features/arbitration/appeal-queue.component';
import { AppealDecisionComponent } from './features/arbitration/appeal-decision.component';
import { UserManagementComponent } from './features/admin/user-management.component';
import { KeywordRulesComponent } from './features/admin/keyword-rules.component';
import { RefundApprovalComponent } from './features/admin/refund-approval.component';
import { AuditLogComponent } from './features/admin/audit-log.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [landingGuard], component: LoginComponent },
  { path: 'auth/login', component: LoginComponent },
  { path: 'auth/register', component: RegisterComponent },
  { path: 'auth/forgot-password', component: ForgotPasswordComponent },
  { path: 'auth/reset-password', component: ResetPasswordComponent },

  { path: 'storefront', component: SellerStorefrontComponent, canActivate: [authOnlyGuard] },
  { path: 'storefront/:sellerId', component: SellerStorefrontComponent, canActivate: [authOnlyGuard] },
  { path: 'listings/browse', component: ListingBrowseComponent, canActivate: [authOnlyGuard] },
  { path: 'listings/my-listings', component: MyListingsComponent, canActivate: [roleGuard], data: { roles: ['seller'] } },
  { path: 'listings/create', component: ListingCreateComponent, canActivate: [roleGuard], data: { roles: ['seller'] } },
  { path: 'listings/:id', component: ListingDetailComponent, canActivate: [authOnlyGuard] },

  { path: 'upload', component: UploadComponent, canActivate: [roleGuard], data: { roles: ['seller'] } },

  { path: 'orders/payment-capture', component: PaymentCaptureComponent, canActivate: [roleGuard], data: { roles: ['seller', 'admin'] } },
  { path: 'orders/list', component: OrderListComponent, canActivate: [roleGuard], data: { roles: ['buyer', 'seller', 'admin'] } },
  { path: 'orders/:id', component: OrderDetailComponent, canActivate: [roleGuard], data: { roles: ['buyer', 'seller', 'admin'] } },

  { path: 'reviews/form', component: ReviewFormComponent, canActivate: [roleGuard], data: { roles: ['buyer'] } },
  { path: 'reviews/list', component: ReviewListComponent, canActivate: [authOnlyGuard] },

  { path: 'moderation/queue', component: ModerationQueueComponent, canActivate: [roleGuard], data: { roles: ['moderator'] } },
  { path: 'moderation/decision', component: ModerationDecisionComponent, canActivate: [roleGuard], data: { roles: ['moderator'] } },

  { path: 'arbitration/queue', component: AppealQueueComponent, canActivate: [roleGuard], data: { roles: ['arbitrator'] } },
  { path: 'arbitration/decision', component: AppealDecisionComponent, canActivate: [roleGuard], data: { roles: ['arbitrator'] } },

  { path: 'admin/users', component: UserManagementComponent, canActivate: [roleGuard], data: { roles: ['admin'] } },
  { path: 'admin/keyword-rules', component: KeywordRulesComponent, canActivate: [roleGuard], data: { roles: ['admin'] } },
  { path: 'admin/refunds', component: RefundApprovalComponent, canActivate: [roleGuard], data: { roles: ['admin'] } },
  { path: 'admin/audit-logs', component: AuditLogComponent, canActivate: [roleGuard], data: { roles: ['admin'] } },

  { path: '**', canActivate: [landingGuard], component: LoginComponent },
];
