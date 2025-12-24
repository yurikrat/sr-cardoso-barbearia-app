import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'date-fns/locale';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
// isSunday será usado no componente pai

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const weekdayShort = (date: Date) => {
    // Compacto e não ambíguo
    // DOM(0) SEG(1) TER(2) QUA(3) QUI(4) SEX(5) SÁB(6)
    const map = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
    return map[date.getDay()] ?? '';
  };

  const captionTitle = (date: Date) => {
    const raw = format(date, 'MMMM yyyy', { locale: ptBR });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={ptBR}
      weekStartsOn={1}
      formatters={{
        formatCaption: (date) => captionTitle(date),
        formatWeekdayName: (date) => weekdayShort(date),
      }}
      className={cn('p-3', className)}
      classNames={{
        // DayPicker v9 (UI.* keys)
        root: 'p-3',
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        button_previous: cn('absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'),
        button_next: cn('absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        weeks: 'flex flex-col',
        week: 'flex w-full mt-2',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button:
          'h-9 w-9 p-0 flex items-center justify-center font-normal rounded-md hover:bg-muted/20',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside:
          'text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        disabled: 'text-muted-foreground opacity-50',
        range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };

