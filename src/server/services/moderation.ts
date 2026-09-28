import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { ReportCreateInput, ReportResolveInput } from '../../shared/schemas';
import type { Block, OrganizerPublic, Report, ReportReason, ReportStatus, User } from '../../shared/types';
import { appLink, type Deps } from '../context';
import { audit, notify, nowIso, sendMailSafe } from './common';
import { renderEmail } from './emails';
import { requireAdmin, reviewOrganizer } from './admin';

/**
 * Content moderation – what App Store Review Guideline 1.2 asks of apps with user-generated content:
 *
 *  - Filtering: only organizers approved by a platform admin can publish (organizers.ts / admin.ts).
 *  - Reporting: anyone can report an event or organizer; the operator is e-mailed right away.
 *  - Removal: admins take an event down or suspend the organizer from the report queue (/admin/rapporter).
 *  - Blocking: a signed-in person can hide an organizer from their feeds and search.
 *  - Contact: SUPPORT_EMAIL is shown in Help and in every receipt.
 */

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  offensive: 'Støtende eller hatefullt innhold',
  fraud: 'Svindel eller falske billetter',
  illegal: 'Ulovlig innhold eller aktivitet',
  misleading: 'Villedende informasjon',
  other: 'Annet',
};

export async function createReport(deps: Deps, reporter: User | null, input: ReportCreateInput): Promise<Report> {
  const now = nowIso(deps);
  const report = await deps.store.tx(async (tx) => {
    let title: string;
    let organizerId: string;
    if (input.kind === 'event') {
      const event = await tx.get('events', input.targetId);
      if (!event || event.status === 'draft') throw new AppError('not_found');
      title = event.title;
      organizerId = event.organizerId;
    } else {
      const org = await tx.get('organizers', input.targetId);
      if (!org || org.status !== 'approved') throw new AppError('not_found');
      title = org.name;
      organizerId = org.id;
    }
    // The same person reporting the same thing again adds nothing to the queue.
    if (reporter) {
      const open = await tx.find('reports', { targetId: input.targetId, status: 'open' });
      const mine = open.find((r) => r.reporterId === reporter.id);
      if (mine) return { report: mine, created: false };
    }
    const doc: Report = {
      id: newId(),
      kind: input.kind,
      targetId: input.targetId,
      targetTitle: title.slice(0, 120),
      organizerId,
      reason: input.reason,
      message: input.message,
      reporterId: reporter?.id ?? null,
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
    };
    await tx.insert('reports', doc);
    await audit(tx, deps, reporter?.id ?? null, 'report.created', 'reports', doc.id, { kind: doc.kind, targetId: doc.targetId, reason: doc.reason });
    return { report: doc, created: true };
  });

  const to = deps.config.supportEmail;
  if (report.created && to) {
    const r = report.report;
    const heading = `Ny rapport: ${r.targetTitle}`;
    const mail = renderEmail({
      appName: 'TIKIT',
      heading,
      paragraphs: [
        `${r.kind === 'event' ? 'Arrangement' : 'Arrangør'}: ${r.targetTitle}`,
        `Grunn: ${REPORT_REASON_LABELS[r.reason]}`,
        r.message ? `Beskrivelse: ${r.message}` : 'Ingen beskrivelse.',
        'Apple forventer at rapporter følges opp raskt (innen 24 timer).',
      ],
      cta: { label: 'Åpne rapportene', url: appLink(deps.config, '/admin/rapporter') },
    });
    await sendMailSafe(deps, { to, subject: heading, html: mail.html, text: mail.text });
  }
  return report.report;
}

export interface AdminReportRow extends Report {
  reasonLabel: string;
  targetLink: string | null;
  targetState: 'visible' | 'taken_down' | 'suspended' | 'gone';
  reports: number;
}

export async function listReports(deps: Deps, admin: User, status: ReportStatus | null): Promise<AdminReportRow[]> {
  requireAdmin(admin);
  return deps.store.read(async (tx) => {
    const all = status ? await tx.find('reports', { status }) : await tx.find('reports');
    const counts = new Map<string, number>();
    for (const r of all) counts.set(r.targetId, (counts.get(r.targetId) ?? 0) + 1);
    const rows: AdminReportRow[] = [];
    for (const r of all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200)) {
      const org = await tx.get('organizers', r.organizerId);
      let targetState: AdminReportRow['targetState'] = 'gone';
      let targetLink: string | null = null;
      if (r.kind === 'event') {
        const e = await tx.get('events', r.targetId);
        if (e) {
          targetState = org?.status === 'suspended' ? 'suspended' : e.takedown ? 'taken_down' : 'visible';
          targetLink = `/e/${e.slug}`;
        }
      } else if (org) {
        targetState = org.status === 'suspended' ? 'suspended' : 'visible';
        targetLink = `/a/${org.slug}`;
      }
      rows.push({ ...r, reasonLabel: REPORT_REASON_LABELS[r.reason], targetLink, targetState, reports: counts.get(r.targetId) ?? 1 });
    }
    return rows;
  });
}

export async function resolveReport(deps: Deps, admin: User, reportId: string, input: ReportResolveInput): Promise<void> {
  requireAdmin(admin);
  const now = nowIso(deps);
  const report = await deps.store.read((tx) => tx.get('reports', reportId));
  if (!report) throw new AppError('not_found');

  if (input.action === 'suspend') {
    await reviewOrganizer(deps, admin, report.organizerId, { status: 'suspended', note: input.note || 'Stengt etter en rapport om innholdet.' });
  }

  await deps.store.tx(async (tx) => {
    if (input.action === 'takedown') {
      if (report.kind !== 'event') throw new AppError('bad_request', { message: 'Bare arrangementer kan skjules. Steng arrangøren i stedet.' });
      const event = await tx.get('events', report.targetId, { forUpdate: true });
      if (!event) throw new AppError('not_found');
      const reason = input.note || 'Skjult av TIKIT etter en rapport om innholdet.';
      // Back to draft: every "is it published?" check (buying, queue, waitlist, resale) now says no. Tickets
      // already sold stay valid at the door; cancel the event to refund them.
      await tx.update('events', event.id, { status: event.status === 'cancelled' ? 'cancelled' : 'draft', featured: false, takedown: { reason, at: now, by: admin.id }, updatedAt: now });
      const members = await tx.find('orgMembers', { organizerId: event.organizerId });
      for (const m of members.filter((x) => x.role !== 'staff')) {
        await notify(tx, deps, m.userId, {
          kind: 'organizer_status',
          title: `«${event.title}» er skjult`,
          body: `${reason} Ta kontakt med TIKIT hvis du mener dette er feil.`,
          link: `/arrangor/${event.organizerId}/arrangementer/${event.id}`,
          email: {
            subject: `«${event.title}» er skjult på TIKIT`,
            heading: `«${event.title}» er skjult`,
            paragraphs: [reason, 'Billetter som allerede er solgt, gjelder fortsatt. Ta kontakt med TIKIT hvis du mener dette er feil.'],
          },
          transactional: true,
        });
      }
      await audit(tx, deps, admin.id, 'event.taken_down', 'events', event.id, { reportId, reason });
    }
    // One decision closes every open report about the same thing.
    const open = await tx.find('reports', { targetId: report.targetId, status: 'open' });
    const status: ReportStatus = input.action === 'dismiss' ? 'dismissed' : 'resolved';
    for (const r of open.length ? open : [report]) {
      await tx.update('reports', r.id, { status, resolution: `${input.action}${input.note ? `: ${input.note}` : ''}`, resolvedBy: admin.id, resolvedAt: now });
    }
    await audit(tx, deps, admin.id, `report.${input.action}`, 'reports', report.id, { note: input.note });
  });
}

/** Admins can put a taken-down event back (as a draft the organizer can publish again). */
export async function restoreEvent(deps: Deps, admin: User, eventId: string): Promise<void> {
  requireAdmin(admin);
  await deps.store.tx(async (tx) => {
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event?.takedown) throw new AppError('not_found');
    await tx.update('events', eventId, { takedown: null, updatedAt: nowIso(deps) });
    await audit(tx, deps, admin.id, 'event.restored', 'events', eventId);
  });
}

// ── Blocking ─────────────────────────────────────────────────────────────────

export async function setBlock(deps: Deps, userId: string, organizerId: string, blocked: boolean): Promise<void> {
  const id = `${userId}:${organizerId}`;
  await deps.store.tx(async (tx) => {
    if (!blocked) {
      await tx.delete('blocks', id);
      return;
    }
    const org = await tx.get('organizers', organizerId);
    if (!org) throw new AppError('not_found');
    if (await tx.get('blocks', id)) return;
    await tx.insert('blocks', { id, userId, organizerId, createdAt: nowIso(deps) } satisfies Block);
    // Hiding someone and following them at the same time makes no sense.
    await tx.delete('follows', id);
  });
}

export async function blockedOrganizerIds(deps: Deps, userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const blocks = await deps.store.read((tx) => tx.find('blocks', { userId }));
  return new Set(blocks.map((b) => b.organizerId));
}

export async function listBlocked(deps: Deps, userId: string): Promise<Pick<OrganizerPublic, 'id' | 'slug' | 'name'>[]> {
  return deps.store.read(async (tx) => {
    const blocks = await tx.find('blocks', { userId });
    const orgs = await tx.getMany(
      'organizers',
      blocks.map((b) => b.organizerId),
    );
    return orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name }));
  });
}
