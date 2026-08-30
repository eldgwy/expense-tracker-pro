import React, { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import { toast } from "sonner";
import {
  PiggyBank,
  Plus,
  Pencil,
  Trash2,
  Target,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Wallet,
  Trophy,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { savingsGoalsApi } from "@/services/savings-goals";
import { ApiError } from "@/services/api";
import type { ApiSavingsGoal, GoalPriority } from "@/services/savings-goals";

const PRIORITY_OPTIONS: { value: GoalPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

const ICON_OPTIONS = [
  { value: "PiggyBank", label: "Piggy Bank" },
  { value: "Wallet", label: "Wallet" },
  { value: "Trophy", label: "Trophy" },
  { value: "Home", label: "Home" },
  { value: "Car", label: "Car" },
  { value: "Plane", label: "Travel" },
  { value: "GraduationCap", label: "Education" },
  { value: "Heart", label: "Health" },
  { value: "Gift", label: "Gift" },
  { value: "Sparkles", label: "Spa" },
  { value: "Briefcase", label: "Work" },
  { value: "Landmark", label: "Bank" },
];

const COLOR_PALETTE = [
  "#10B981",
  "#F59E0B",
  "#06B6D4",
  "#8B5CF6",
  "#F43F5E",
  "#EC4899",
  "#6366F1",
  "#14B8A6",
  "#EAB308",
  "#3B82F6",
  "#F97316",
  "#A855F7",
];

const priorityVariant: Record<GoalPriority, "secondary" | "info" | "warning" | "error"> = {
  LOW: "secondary",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "error",
};

function formatCurrency(value?: number | null): string {
  const num = typeof value === "number" && !isNaN(value) ? value : 0;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "No deadline";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Savings Goals page — track progress toward financial targets with contributions
 * and withdrawals. Fetches real data with skeleton loading states.
 * Route: /savings-goals
 */
export const SavingsGoalsPage: React.FC = () => {
  // ─── Data state ──────────────────────────────────────────
  const [goals, setGoals] = useState<ApiSavingsGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Modal state ─────────────────────────────────────────
  const [showFormModal, setShowFormModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<ApiSavingsGoal | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressMode, setProgressMode] = useState<"add" | "withdraw">("add");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [progressSubmitting, setProgressSubmitting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ─── Form state ──────────────────────────────────────────
  const [formName, setFormName] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formCurrent, setFormCurrent] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [formPriority, setFormPriority] = useState<GoalPriority>("MEDIUM");
  const [formIcon, setFormIcon] = useState("PiggyBank");
  const [formColor, setFormColor] = useState(COLOR_PALETTE[0]);
  const [progressAmount, setProgressAmount] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const goalsData = await savingsGoalsApi.findAll();
      setGoals(goalsData);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load savings goals";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const goalsData = await savingsGoalsApi.findAll();
        if (ignore) return;
        setGoals(goalsData);
        setError(null);
      } catch (err) {
        if (ignore) return;
        const message = err instanceof ApiError ? err.message : "Failed to load savings goals";
        setError(message);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    };
    load();
    return () => {
      ignore = true;
    };
  }, []);

  // ─── Modal helpers ───────────────────────────────────────
  const openCreateModal = () => {
    setSelectedGoal(null);
    setFormName("");
    setFormTarget("");
    setFormCurrent("");
    setFormDeadline("");
    setFormPriority("MEDIUM");
    setFormIcon("PiggyBank");
    setFormColor(COLOR_PALETTE[0]);
    setShowFormModal(true);
  };

  const openEditModal = (goal: ApiSavingsGoal) => {
    setSelectedGoal(goal);
    setFormName(goal.name);
    setFormTarget(String(goal.targetAmount));
    setFormCurrent(String(goal.currentAmount));
    setFormDeadline(goal.deadline ? goal.deadline.slice(0, 10) : "");
    setFormPriority(goal.priority);
    setFormIcon(goal.icon);
    setFormColor(goal.color);
    setShowFormModal(true);
  };

  const openProgressModal = (goal: ApiSavingsGoal, mode: "add" | "withdraw") => {
    setSelectedGoal(goal);
    setProgressMode(mode);
    setProgressAmount("");
    setShowProgressModal(true);
  };

  const openDeleteDialog = (goal: ApiSavingsGoal) => {
    setSelectedGoal(goal);
    setShowDeleteDialog(true);
  };

  // ─── Handlers ────────────────────────────────────────────
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const target = Number(formTarget);
    if (!target || target <= 0) {
      toast.error("Please enter a valid target amount");
      return;
    }
    if (!formName.trim()) {
      toast.error("Goal name is required");
      return;
    }

    setFormSubmitting(true);
    try {
      const payload = {
        name: formName.trim(),
        targetAmount: target,
        currentAmount: formCurrent ? Number(formCurrent) : undefined,
        deadline: formDeadline || undefined,
        priority: formPriority,
        icon: formIcon,
        color: formColor,
      };
      if (selectedGoal) {
        await savingsGoalsApi.update(selectedGoal.id, payload);
        toast.success("Savings goal updated");
      } else {
        await savingsGoalsApi.create(payload);
        toast.success("Savings goal created");
      }
      setShowFormModal(false);
      await fetchData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save savings goal";
      toast.error("Save failed", { description: message });
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleProgressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoal) return;

    const amount = Number(progressAmount);
    if (!amount || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setProgressSubmitting(true);
    try {
      if (progressMode === "add") {
        await savingsGoalsApi.addProgress(selectedGoal.id, { amount });
        toast.success(`Added ${formatCurrency(amount)} to "${selectedGoal.name}"`);
      } else {
        await savingsGoalsApi.withdrawProgress(selectedGoal.id, { amount });
        toast.success(`Withdrew ${formatCurrency(amount)} from "${selectedGoal.name}"`);
      }
      setShowProgressModal(false);
      await fetchData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to update progress";
      toast.error("Update failed", { description: message });
    } finally {
      setProgressSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedGoal || deleteLoading) return;
    setDeleteLoading(true);
    try {
      await savingsGoalsApi.delete(selectedGoal.id);
      toast.success(`Savings goal "${selectedGoal.name}" deleted`);
      setShowDeleteDialog(false);
      setSelectedGoal(null);
      await fetchData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to delete savings goal";
      toast.error("Delete failed", { description: message });
    } finally {
      setDeleteLoading(false);
    }
  };

  // ─── Loading state ───────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0 animate-[fade-in_0.3s_ease-out]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-60 mt-2" />
          </div>
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-reveal">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="size-10 rounded-xl" />
              </div>
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>

        {/* Overall progress skeleton */}
        <div className="glass rounded-xl p-6 space-y-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>

        {/* Goal cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-reveal">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <Skeleton className="size-11 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-2 w-full rounded-full mb-4" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Error state ─────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0 animate-[fade-in_0.3s_ease-out]">
        <EmptyState
          icon={AlertCircle}
          title="Failed to Load Savings Goals"
          description={error}
          actionLabel="Try Again"
          onAction={() => {
            setIsLoading(true);
            void fetchData();
          }}
          iconColor="text-error"
        />
      </div>
    );
  }

  // ─── Empty state ─────────────────────────────────────────
  if (goals.length === 0) {
    return (
      <div className="space-y-6 pb-20 lg:pb-0 animate-[fade-in_0.3s_ease-out]">
        <EmptyState
          icon={PiggyBank}
          title="No Savings Goals Yet"
          description="Create savings goals to track progress toward your financial targets."
          actionLabel="+ Create Savings Goal"
          onAction={openCreateModal}
          iconColor="text-primary"
        />

        <CreateGoalModal
          isOpen={showFormModal}
          onClose={() => setShowFormModal(false)}
          selectedGoal={selectedGoal}
          formName={formName}
          setFormName={setFormName}
          formTarget={formTarget}
          setFormTarget={setFormTarget}
          formCurrent={formCurrent}
          setFormCurrent={setFormCurrent}
          formDeadline={formDeadline}
          setFormDeadline={setFormDeadline}
          formPriority={formPriority}
          setFormPriority={setFormPriority}
          formIcon={formIcon}
          setFormIcon={setFormIcon}
          formColor={formColor}
          setFormColor={setFormColor}
          submitting={formSubmitting}
          onSubmit={handleFormSubmit}
        />
      </div>
    );
  }

  // ─── Data state ──────────────────────────────────────────
  const completedCount = goals.filter((g) => g.isCompleted).length;
  const totalSaved = goals.reduce((sum, g) => sum + g.currentAmount, 0);
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const overallProgress = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

  const activeGoals = goals.filter((g) => !g.isCompleted);

  return (
    <div className="space-y-6 pb-20 lg:pb-0 animate-[fade-in_0.3s_ease-out]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="page-title font-bold text-text-primary">Savings Goals</h2>
          <p className="text-sm text-text-secondary mt-1">
            Track progress toward your financial targets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              void fetchData();
            }}
            aria-label="Refresh savings goals"
            leftIcon={<RefreshCw className="size-4" />}
          >
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={openCreateModal}>
            New Goal
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-reveal">
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">Total Goals</span>
            <div className="size-10 rounded-xl flex items-center justify-center bg-primary/15">
              <Target className="size-5 text-primary" />
            </div>
          </div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{goals.length}</p>
        </div>
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">Active</span>
            <div className="size-10 rounded-xl flex items-center justify-center bg-accent/15">
              <Wallet className="size-5 text-accent" />
            </div>
          </div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{activeGoals.length}</p>
        </div>
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">Completed</span>
            <div className="size-10 rounded-xl flex items-center justify-center bg-success/15">
              <Trophy className="size-5 text-success" />
            </div>
          </div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{completedCount}</p>
        </div>
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">Total Saved</span>
            <div className="size-10 rounded-xl flex items-center justify-center bg-warning/15">
              <PiggyBank className="size-5 text-warning" />
            </div>
          </div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">
            {formatCurrency(totalSaved)}
          </p>
        </div>
      </div>

      {/* Overall progress */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-text-primary">Overall Savings Progress</h3>
          <Badge variant={overallProgress >= 100 ? "success" : "default"} dot>
            {overallProgress}%
          </Badge>
        </div>
        <ProgressBar value={totalSaved} max={totalTarget || 1} size="md" />
        <div className="flex items-center justify-between mt-3 text-sm text-text-secondary">
          <span>
            Saved:{" "}
            <span className="font-semibold text-text-primary tabular-nums">
              {formatCurrency(totalSaved)}
            </span>
          </span>
          <span>
            Target:{" "}
            <span className="font-semibold text-text-primary tabular-nums">
              {formatCurrency(totalTarget)}
            </span>
          </span>
        </div>
      </div>

      {/* Goal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-reveal">
        {goals.map((goal) => {
          const pct = goal.progress;
          return (
            <div
              key={goal.id}
              className={clsx(
                "glass rounded-xl p-5 hover:shadow-hover hover:-translate-y-0.5 transition-all duration-150",
                goal.isCompleted && "opacity-90",
              )}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="size-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${goal.color}20` }}
                >
                  <CategoryIcon name={goal.icon} size={22} style={{ color: goal.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary truncate flex items-center gap-2">
                    {goal.name}
                    {goal.isCompleted && (
                      <CheckCircle2
                        className="size-4 text-success shrink-0"
                        aria-label="Completed"
                      />
                    )}
                  </h3>
                  <Badge variant={priorityVariant[goal.priority]}>{goal.priority}</Badge>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={clsx(
                      "text-sm font-bold tabular-nums",
                      pct >= 100 ? "text-success" : "text-text-primary",
                    )}
                  >
                    {pct}%
                  </p>
                  <p className="text-[11px] text-text-muted">complete</p>
                </div>
              </div>

              <div className="mb-2">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-text-secondary tabular-nums">
                    {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                  </span>
                  <span className="text-text-muted text-xs">
                    {formatCurrency(goal.remaining)} left
                  </span>
                </div>
                <ProgressBar
                  value={goal.currentAmount}
                  max={goal.targetAmount || 1}
                  size="sm"
                  color={pct >= 100 ? "bg-success" : undefined}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-text-muted mt-3">
                <span>
                  Deadline: <span className="text-text-secondary">{formatDate(goal.deadline)}</span>
                </span>
              </div>

              <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border-card/50">
                {goal.isCompleted ? (
                  <Badge variant="success" dot>
                    Goal Completed
                  </Badge>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      leftIcon={<ArrowUpRight className="size-3.5 text-success" />}
                      onClick={() => openProgressModal(goal, "add")}
                    >
                      Add
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1"
                      leftIcon={<ArrowDownRight className="size-3.5 text-warning" />}
                      onClick={() => openProgressModal(goal, "withdraw")}
                    >
                      Withdraw
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Pencil className="size-3.5" />}
                      onClick={() => openEditModal(goal)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-error/70 hover:text-error"
                      leftIcon={<Trash2 className="size-3.5" />}
                      onClick={() => openDeleteDialog(goal)}
                    >
                      <span className="sr-only">Delete {goal.name}</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Goal Modal */}
      <CreateGoalModal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        selectedGoal={selectedGoal}
        formName={formName}
        setFormName={setFormName}
        formTarget={formTarget}
        setFormTarget={setFormTarget}
        formCurrent={formCurrent}
        setFormCurrent={setFormCurrent}
        formDeadline={formDeadline}
        setFormDeadline={setFormDeadline}
        formPriority={formPriority}
        setFormPriority={setFormPriority}
        formIcon={formIcon}
        setFormIcon={setFormIcon}
        formColor={formColor}
        setFormColor={setFormColor}
        submitting={formSubmitting}
        onSubmit={handleFormSubmit}
      />

      {/* Add / Withdraw Progress Modal */}
      <Modal
        isOpen={showProgressModal}
        onClose={() => setShowProgressModal(false)}
        title={progressMode === "add" ? "Add to Savings Goal" : "Withdraw from Goal"}
        description={`${selectedGoal?.name ?? ""} — current balance ${selectedGoal ? formatCurrency(selectedGoal.currentAmount) : ""}`}
      >
        <form className="space-y-4" onSubmit={handleProgressSubmit}>
          <Input
            label={progressMode === "add" ? "Amount to Add ($)" : "Amount to Withdraw ($)"}
            type="number"
            placeholder="0.00"
            step="0.01"
            min="0.01"
            value={progressAmount}
            onChange={(e) => setProgressAmount(e.target.value)}
            leftIcon={
              progressMode === "add" ? (
                <ArrowUpRight className="size-4 text-success" />
              ) : (
                <ArrowDownRight className="size-4 text-warning" />
              )
            }
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={() => setShowProgressModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={progressSubmitting}
              variant={progressMode === "withdraw" ? "danger" : "primary"}
            >
              {progressMode === "add" ? "Add Funds" : "Withdraw"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title={`Delete "${selectedGoal?.name ?? ""}"?`}
        description="This will permanently remove the savings goal and its progress."
        confirmLabel="Delete Goal"
        isLoading={deleteLoading}
      />
    </div>
  );
};

// ─── Create/Edit Goal Modal ────────────────────────────────

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedGoal: ApiSavingsGoal | null;
  formName: string;
  setFormName: (v: string) => void;
  formTarget: string;
  setFormTarget: (v: string) => void;
  formCurrent: string;
  setFormCurrent: (v: string) => void;
  formDeadline: string;
  setFormDeadline: (v: string) => void;
  formPriority: GoalPriority;
  setFormPriority: (v: GoalPriority) => void;
  formIcon: string;
  setFormIcon: (v: string) => void;
  formColor: string;
  setFormColor: (v: string) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

const CreateGoalModal: React.FC<CreateGoalModalProps> = ({
  isOpen,
  onClose,
  selectedGoal,
  formName,
  setFormName,
  formTarget,
  setFormTarget,
  formCurrent,
  setFormCurrent,
  formDeadline,
  setFormDeadline,
  formPriority,
  setFormPriority,
  formIcon,
  setFormIcon,
  formColor,
  setFormColor,
  submitting,
  onSubmit,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={selectedGoal ? "Edit Savings Goal" : "Create Savings Goal"}
    description="Define a financial target and track your progress toward it."
  >
    <form className="space-y-4" onSubmit={onSubmit}>
      <Input
        label="Goal Name"
        type="text"
        placeholder="e.g. Emergency Fund, Vacation 2027"
        value={formName}
        onChange={(e) => setFormName(e.target.value)}
        required
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Target Amount ($)"
          type="number"
          placeholder="10000.00"
          step="0.01"
          min="0.01"
          value={formTarget}
          onChange={(e) => setFormTarget(e.target.value)}
          required
        />
        <Input
          label="Current Amount ($)"
          type="number"
          placeholder="0.00"
          step="0.01"
          min="0"
          value={formCurrent}
          onChange={(e) => setFormCurrent(e.target.value)}
          helperText={selectedGoal ? "Set to adjust current balance" : "Optional starting amount"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Deadline"
          type="date"
          value={formDeadline}
          onChange={(e) => setFormDeadline(e.target.value)}
        />
        <Select
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={formPriority}
          onChange={(e) => setFormPriority(e.target.value as GoalPriority)}
        />
      </div>

      {/* Color Picker */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-secondary">Color</label>
        <div className="flex flex-wrap gap-2">
          {COLOR_PALETTE.map((color) => {
            const isSelected = formColor.toUpperCase() === color.toUpperCase();
            return (
              <button
                key={color}
                type="button"
                onClick={() => setFormColor(color)}
                className={clsx(
                  "size-8 rounded-full transition-all",
                  isSelected
                    ? "ring-2 ring-offset-2 ring-offset-bg-app ring-primary scale-110"
                    : "hover:scale-110",
                )}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
                aria-pressed={isSelected}
              />
            );
          })}
        </div>
      </div>

      {/* Icon Picker */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-text-secondary">Icon</label>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {ICON_OPTIONS.map((opt) => {
            const isSelected = formIcon === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormIcon(opt.value)}
                className={clsx(
                  "flex flex-col items-center gap-1 rounded-xl p-2.5 transition-all",
                  isSelected
                    ? "bg-primary/15 ring-2 ring-primary ring-offset-1 ring-offset-bg-app scale-105"
                    : "hover:bg-overlay/5 hover:scale-105",
                )}
                title={opt.label}
                aria-label={`Select icon: ${opt.label}`}
                aria-pressed={isSelected}
              >
                <CategoryIcon
                  name={opt.value}
                  size={22}
                  className={isSelected ? "text-primary" : "text-text-secondary"}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" isLoading={submitting}>
          {selectedGoal ? "Save Changes" : "Create Goal"}
        </Button>
      </div>
    </form>
  </Modal>
);
