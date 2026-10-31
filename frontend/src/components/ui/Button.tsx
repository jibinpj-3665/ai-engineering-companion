import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--accent)/0.9)] hover:brightness-110 active:scale-[0.985]",
        secondary: "bg-muted text-foreground hover:bg-muted/70 border border-border",
        outline: "border border-border bg-transparent text-foreground hover:border-primary/[0.45] hover:bg-primary/5",
        ghost: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        danger: "bg-danger/[0.12] text-danger border border-danger/30 hover:bg-danger/20",
        success: "bg-success/[0.12] text-success border border-success/30 hover:bg-success/20",
        gradient:
          "text-white shadow-[0_18px_40px_-16px_hsl(var(--accent)/0.95)] bg-[linear-gradient(100deg,hsl(var(--accent)),hsl(var(--accent-2)))] hover:brightness-110 active:scale-[0.985]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-[0.95rem]",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
