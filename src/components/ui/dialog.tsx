import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Если true (по умолчанию), клик вне окна или Escape не закрывают диалог сразу —
   * сначала показывается подтверждение "Закрыть окно?". Явное закрытие через
   * крестик или кнопки внутри диалога происходит без подтверждения.
   */
  confirmClose?: boolean
  /**
   * Спрятать стандартный крестик в правом верхнем углу. Нужен окнам, которые рисуют
   * свою кнопку закрытия: на весь экран (QR-код сотрудника) маленький крестик
   * прижимается к самому краю и наезжает на заголовок.
   */
  hideClose?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, confirmClose = true, hideClose = false, onPointerDownOutside, onEscapeKeyDown, onInteractOutside, ...props }, ref) => {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        onPointerDownOutside={(event) => {
          if (confirmClose) {
            event.preventDefault()
            setConfirmOpen(true)
          }
          onPointerDownOutside?.(event)
        }}
        onEscapeKeyDown={(event) => {
          if (confirmClose) {
            event.preventDefault()
            setConfirmOpen(true)
          }
          onEscapeKeyDown?.(event)
        }}
        onInteractOutside={(event) => {
          if (confirmClose) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        className={cn(
          // max-h + overflow-y-auto: длинное окно (много полей) не уезжает за край
          // экрана — содержимое прокручивается, и нижние кнопки всегда доступны.
          //
          // На телефоне окно раньше прижималось вплотную к краям и часть его уходила
          // за экран влево: ширина считалась от всего экрана, а поля по бокам не
          // закладывались. w-[calc(100%-2rem)] оставляет по 1 рем с каждой стороны,
          // а внутренние отступы на узком экране делаем меньше — иначе на контент
          // остаётся слишком узкая полоса.
          "fixed left-[50%] top-[50%] z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden border bg-background p-4 shadow-lg sm:w-full sm:p-6 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}
      >
        {children}
        {/* Кнопку не убираем из разметки, а лишь прячем: через неё закрывается окно
            после подтверждения «Закрыть окно?». Удали её — и подтверждение перестанет
            срабатывать. */}
        <DialogPrimitive.Close
          ref={closeRef}
          className={cn(
            "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground",
            hideClose && "sr-only"
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>

      {confirmClose && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Закрыть окно?</AlertDialogTitle>
              <AlertDialogDescription>
                Несохранённые изменения будут потеряны.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Остаться</AlertDialogCancel>
              <AlertDialogAction onClick={() => closeRef.current?.click()}>
                Закрыть
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}