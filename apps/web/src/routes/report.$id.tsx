import { useState } from "react";
import { activityOptions, classroomsOptions, reportOptions } from "@/api/queries";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import {
  ApiError,
  api,
  type Engagement,
  type EngagementVisibility,
  type Report,
  type ReportPosition,
  type StudentAnalysis,
  type TeacherReport,
  type ViolationSlice,
} from "@/api";
import { meOf } from "@/api/me";
import { StanceConstellation } from "@/components/StanceConstellation";
import { Checkbox, Segmented, Spinner, cn } from "@/components/ui";
import { type MessageKey, useT } from "@/i18n";

export const Route = createFileRoute("/report/$id")({
  beforeLoad: async ({ context, location }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { next: location.href }, replace: true });
  },
  component: ReportPage,
});

const ENGAGEMENT_DIMENSIONS = [
  ["substance", "report_engagement_substance"],
  ["uptake", "report_engagement_uptake"],
  ["focus", "report_engagement_focus"],
] as const satisfies ReadonlyArray<readonly [keyof Engagement, MessageKey]>;

function ReportPage() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<"group" | "individual">("group");
  const [studentId, setStudentId] = useState<string | null>(null);
  const report = useQuery(reportOptions(id));
  const err = report.isError && report.error instanceof ApiError ? report.error : null;
  const failed = err?.code === "report_failed";
  const activity = useQuery({ ...activityOptions(id), enabled: failed });
  const rooms = useQuery({ ...classroomsOptions, enabled: failed });

  if (report.isPending || (failed && (activity.isPending || rooms.isPending))) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (report.isError) {
    const pending = err?.code === "report_pending";
    if (failed) {
      const isTeacher =
        activity.data != null &&
        rooms.data?.some((room) => room.id === activity.data.classroomId && room.role === "teacher") === true;
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[15px] text-ink-soft">
          {isTeacher ? (
            <>
              <p>{err?.message ?? t("common_error")}</p>
              <button
                type="button"
                onClick={() => void navigate({ to: "/t/live/$id", params: { id } })}
                className="cursor-pointer rounded-full border border-line-strong bg-paper-deep px-4 py-1.5 text-[13px] text-ink transition-colors hover:text-ember"
              >
                {t("report_refinish")}
              </button>
            </>
          ) : (
            <p>{t("report_failed_student")}</p>
          )}
        </div>
      );
    }
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[15px] text-ink-soft">
        <p>{pending ? t("report_generating") : (err?.message ?? t("common_error"))}</p>
        <button
          type="button"
          onClick={() => report.refetch()}
          className="cursor-pointer rounded-full border border-line-strong bg-paper-deep px-4 py-1.5 text-[13px] text-ink transition-colors hover:text-ember"
        >
          {t("report_retry")}
        </button>
      </div>
    );
  }

  const data = report.data;
  const isTeacherView = "students" in data;
  const person = isTeacherView
    ? (data.students.find((student) => student.participantId === studentId) ?? data.students[0])
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 pl-12 md:pl-0">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">{t("report_title")}</h1>
          <p className="mt-1 text-[13px] text-ink-faint">{data.topicTitle}</p>
        </div>
        {isTeacherView && (
          <Segmented
            label={t("report_title")}
            value={view}
            onChange={setView}
            items={[
              { value: "group", label: t("report_group") },
              { value: "individual", label: t("report_individual") },
            ]}
          />
        )}
      </div>

      {isTeacherView && <EngagementSharing activityId={id} visibility={data.engagementVisibility} />}

      {!isTeacherView && (
        <section className="mt-6 flex flex-col gap-6">
          <p className="text-[14px] text-ink-soft">{data.participantName}</p>
          <Positions positions={data.positions} />
          <Analysis analysis={data.analysis} violations={data.violations} />
          {data.engagement && <EngagementPanel engagement={data.engagement} />}
        </section>
      )}

      {isTeacherView && view === "group" && (
        <section className="mt-6 flex flex-col gap-8">
          <TeacherReminders
            report={data}
            onSelect={(id) => {
              setStudentId(id);
              setView("individual");
            }}
          />
          {data.classReport ? (
            <>
              <div className="flex flex-col gap-2">
                <h2 className="font-serif text-lg font-semibold text-ink">{t("report_overview")}</h2>
                {data.classReport.overview.map((line) => (
                  <p key={line} className="text-[14.5px] leading-relaxed text-ink-soft">
                    {line}
                  </p>
                ))}
              </div>

              {data.classReport.axes.length > 0 && <StanceConstellation key={id} axes={data.classReport.axes} />}

              <div className="flex flex-col gap-4">
                <h2 className="font-serif text-lg font-semibold text-ink">{t("report_axes")}</h2>
                {data.classReport.axes.map((axis) => (
                  <div key={axis.name} className="rounded-2xl border border-line bg-card p-5">
                    <p className="text-[15px] font-medium text-ink">
                      {axis.name}：{axis.low} ↔ {axis.high}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {axis.positions.map((position) => (
                        <li key={`${axis.name}-${position.id}`} className="text-[13.5px] text-ink-soft">
                          <span className="font-medium text-ink">{position.id}</span>
                          <span className="text-ink-faint"> · {t("report_position", { at: position.at })}</span>
                          <span> — {position.view}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">{axis.why}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-line bg-card p-5">
              <p className="text-[14px] text-ink-soft">{t("report_partial")}</p>
            </div>
          )}
          {data.engagementVisibility.classReport && (
            <ClassEngagement
              rows={data.students.map((student) => ({ pseudonym: student.pseudonym, engagement: student.engagement }))}
            />
          )}
        </section>
      )}

      {isTeacherView && view === "individual" && person && (
        <section className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            {data.students.map((student) => (
              <button
                type="button"
                key={student.participantId}
                onClick={() => setStudentId(student.participantId)}
                aria-pressed={student.participantId === person.participantId}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                  student.participantId === person.participantId
                    ? "border-ember bg-ember-wash font-medium text-ember"
                    : "border-line bg-card text-ink-soft",
                )}
              >
                {student.participantName}
                {student.participantName === student.pseudonym ? null : (
                  <span className="ml-1.5 text-ink-faint">· {student.pseudonym}</span>
                )}
              </button>
            ))}
          </div>
          <h2
            tabIndex={-1}
            ref={focusStudentHeading}
            className="font-serif text-xl font-semibold text-ink wrap-anywhere"
          >
            {person.participantName}
          </h2>
          <Positions positions={person.positions} />
          <Analysis analysis={person.analysis} violations={person.violations} />
          <EngagementPanel engagement={person.engagement} />
        </section>
      )}
    </div>
  );
}

function EngagementSharing({ activityId, visibility }: { activityId: string; visibility: EngagementVisibility }) {
  const t = useT();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: EngagementVisibility) => api.setEngagementVisibility(activityId, next),
    onSuccess: (saved) =>
      queryClient.setQueryData<Report>(reportOptions(activityId).queryKey, (report) =>
        report && "students" in report ? { ...report, engagementVisibility: saved } : report,
      ),
  });
  const shown = save.isPending && save.variables ? save.variables : visibility;
  const toggle = (patch: Partial<EngagementVisibility>) => {
    if (!save.isPending) save.mutate({ ...shown, ...patch });
  };
  return (
    <fieldset
      aria-busy={save.isPending}
      className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-card px-4 py-3"
    >
      <legend className="sr-only">{t("report_engagement_share")}</legend>
      <span aria-hidden className="text-[13px] font-medium text-ink">
        {t("report_engagement_share")}
      </span>
      <Checkbox
        label={t("report_engagement_share_class")}
        checked={shown.classReport}
        onCheckedChange={(classReport) => toggle({ classReport })}
      />
      <Checkbox
        label={t("report_engagement_share_student")}
        checked={shown.student}
        onCheckedChange={(student) => toggle({ student })}
      />
      {save.isError && (
        <p role="alert" className="text-[13px] text-flag">
          {t("report_engagement_share_failed")}
        </p>
      )}
    </fieldset>
  );
}

function EngagementPanel({ engagement }: { engagement: Engagement | null }) {
  const t = useT();
  if (!engagement) return null;
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div>
        <h2 className="font-serif text-lg font-semibold text-ink">{t("report_engagement")}</h2>
        <p className="mt-1 text-[12.5px] text-ink-faint">{t("report_engagement_hint")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {ENGAGEMENT_DIMENSIONS.map(([key, label]) => {
          const { level, turns, evidence } = engagement[key];
          return (
            <li key={key} className="rounded-2xl border border-line bg-card px-4 py-3">
              <p className="flex items-baseline justify-between gap-3 text-[13px] font-medium text-moss">
                <span>{t(label)}</span>
                <span className="tabular-nums text-ink">{t("report_engagement_level", { level })}</span>
              </p>
              <p className="mt-1 text-[14px] text-ink">{level === 0 ? t("report_engagement_unseen") : evidence}</p>
              {turns.length > 0 && (
                <p className="mt-0.5 text-[12.5px] text-ink-faint">
                  {t("report_turn_ref", { turns: turns.join("、") })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClassEngagement({ rows }: { rows: Array<{ pseudonym: string; engagement: Engagement | null }> }) {
  const t = useT();
  const judged = rows.filter((row): row is { pseudonym: string; engagement: Engagement } => row.engagement !== null);
  if (judged.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-serif text-lg font-semibold text-ink">{t("report_engagement")}</h2>
      <p className="text-[12.5px] text-ink-faint">{t("report_engagement_hint")}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-ink-faint">
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">{t("report_engagement_pseudonym")}</span>
              </th>
              {ENGAGEMENT_DIMENSIONS.map(([key, label]) => (
                <th key={key} scope="col" className="px-4 py-2 font-medium">
                  {t(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {judged.map(({ pseudonym, engagement }) => (
              <tr key={pseudonym} className="border-b border-line last:border-0">
                <th scope="row" className="px-4 py-2 font-medium text-ink">
                  {pseudonym}
                </th>
                {ENGAGEMENT_DIMENSIONS.map(([key]) => (
                  <td key={key} className="px-4 py-2 tabular-nums text-ink-soft">
                    {t("report_engagement_level", { level: engagement[key].level })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function focusStudentHeading(heading: HTMLHeadingElement | null) {
  heading?.focus();
}

function offTopicViolations(violations: ViolationSlice[]) {
  return violations.flatMap((violation) =>
    violation.type === "on_topic" ? [] : [{ ...violation, type: violation.type }],
  );
}

function TeacherReminders({ report, onSelect }: { report: TeacherReport; onSelect: (id: string) => void }) {
  const t = useT();
  const unstated = new Set(report.classReport?.unstated);
  const groups = [
    {
      label: "report_attention_off_topic",
      entries: report.students.flatMap((student) => {
        const types = [...new Set(offTopicViolations(student.violations).map(({ type }) => type))];
        return types.length ? [{ student, detail: types.map((type) => t(`live_flag_${type}`)).join(" · ") }] : [];
      }),
    },
    {
      label: "report_attention_unstated",
      entries: report.students
        .filter((student) => student.analysis?.stated === false || unstated.has(student.pseudonym))
        .map((student) => ({ student, detail: null })),
    },
    {
      label: "report_attention_incomplete",
      entries: report.students
        .filter((student) => student.analysis === null)
        .map((student) => ({ student, detail: null })),
    },
  ] as const;
  const visibleGroups = groups.filter(({ entries }) => entries.length > 0);

  return (
    <section aria-labelledby="teacher-reminders-title" className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <h2 id="teacher-reminders-title" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
        <Flag className="size-4 shrink-0 text-flag" aria-hidden />
        {t("report_attention")}
      </h2>
      {visibleGroups.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("report_attention_empty")}</p>
      ) : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          {visibleGroups.map(({ label, entries }) => (
            <div key={label} className="min-w-0 rounded-xl border border-line px-3 py-2">
              <h3 className="px-1 pt-1 text-sm font-semibold text-ink">{t(label)}</h3>
              <ul className="mt-1 divide-y divide-line">
                {entries.map(({ student, detail }) => (
                  <li key={student.participantId}>
                    <button
                      type="button"
                      onClick={() => onSelect(student.participantId)}
                      className="flex min-h-11 w-full cursor-pointer flex-col justify-center rounded-lg px-1 py-1.5 text-start text-sm font-medium text-ember wrap-anywhere hover:bg-paper-deep hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
                    >
                      {student.participantName}
                      {detail && " "}
                      {detail && <span className="text-xs font-normal text-ink-soft">{detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Positions({ positions }: { positions: ReportPosition[] }) {
  const t = useT();
  if (positions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-serif text-lg font-semibold text-ink">{t("report_positions")}</h2>
      <ul className="flex max-w-2xl flex-col gap-2">
        {positions.map((position) => (
          <li key={position.axis} className="rounded-2xl border border-line bg-card px-4 py-3 text-[14px] text-ink">
            <span className="font-medium">{position.axis}</span>
            <span className="text-ink-faint"> · {t("report_position", { at: position.at })}</span>
            <p className="mt-1 text-[13.5px] text-ink-soft">{position.view}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Analysis({ analysis, violations }: { analysis: StudentAnalysis | null; violations: ViolationSlice[] }) {
  const t = useT();
  const offTopic = offTopicViolations(violations);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {analysis ? (
        <ArgumentSummary analysis={analysis} />
      ) : (
        <p className="text-[14px] text-ink-faint">{t("report_no_data")}</p>
      )}
      {offTopic.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-lg font-semibold text-flag">{t("report_violations")}</h2>
          {offTopic.map((violation, index) => (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: several violations can share one turn; the index disambiguates
              key={`${violation.turn}-${violation.type}-${index}`}
              className="rounded-xl bg-flag-wash px-4 py-2 text-[13px] text-ink-soft wrap-anywhere"
            >
              #{violation.turn} · {t(`live_flag_${violation.type}`)} —「{violation.excerpt}」
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ArgumentSummary({ analysis }: { analysis: StudentAnalysis }) {
  const t = useT();
  const turns = (ids: readonly number[]) => t("report_turn_ref", { turns: ids.join("、") });
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h2 className="font-serif text-lg font-semibold text-ink">{t("report_summary")}</h2>
      {analysis.stated ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="text-[13px] font-medium text-moss">{t("report_claim")}</p>
            <p className="mt-1 text-[14.5px] text-ink">{analysis.claim.text}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">{turns(analysis.claim.turns)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="text-[13px] font-medium text-moss">{t("report_reason")}</p>
            <p className="mt-1 text-[14.5px] text-ink">{analysis.reasons.text}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">{turns(analysis.reasons.turns)}</p>
          </div>
          {analysis.tension && (
            <div className="rounded-2xl border border-line bg-card p-4">
              <p className="text-[13px] font-medium text-ember">{t("report_tension")}</p>
              <p className="mt-1 text-[14.5px] text-ink">{analysis.tension.text}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">{turns(analysis.tension.turns)}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="text-[13px] font-medium text-moss">{t("report_doing")}</p>
          <p className="mt-1 text-[14.5px] text-ink">{analysis.doing.text}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-faint">{turns(analysis.doing.turns)}</p>
        </div>
      )}
    </div>
  );
}
