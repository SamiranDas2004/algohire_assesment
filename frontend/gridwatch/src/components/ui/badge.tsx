import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-slate-700 bg-slate-800 text-slate-300',
        healthy: 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400',
        warning: 'border-yellow-500/30 bg-yellow-500/20 text-yellow-400',
        critical: 'border-red-500/30 bg-red-500/20 text-red-400',
        silent: 'border-slate-600/30 bg-slate-600/20 text-slate-400',
        open: 'border-blue-500/30 bg-blue-500/20 text-blue-400',
        acknowledged: 'border-orange-500/30 bg-orange-500/20 text-orange-400',
        resolved: 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400',
        escalated: 'border-purple-500/30 bg-purple-500/20 text-purple-400',
        suppressed: 'border-slate-500/30 bg-slate-500/20 text-slate-400',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
