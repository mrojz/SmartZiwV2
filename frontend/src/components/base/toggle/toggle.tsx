import type { ReactNode } from "react";
import { useId } from "react";
import type { SwitchProps as AriaSwitchProps } from "react-aria-components";
import { Switch as AriaSwitch } from "react-aria-components";
import { cx } from "@/utils/cx";

interface ToggleBaseProps {
    size?: "sm" | "md";
    slim?: boolean;
    className?: string;
    isHovered?: boolean;
    isFocusVisible?: boolean;
    isSelected?: boolean;
    isDisabled?: boolean;
}

export const ToggleBase = ({ className, isHovered, isDisabled, isFocusVisible, isSelected, slim, size = "sm" }: ToggleBaseProps) => {
    const styles = {
        default: {
            sm: {
                root: "h-5 w-9 p-[2px]",
                switch: cx("size-4", isSelected && "translate-x-4"),
            },
            md: {
                root: "h-[22px] w-10 p-[2px]",
                switch: cx("size-[18px]", isSelected && "translate-x-[18px]"),
            },
        },
        slim: {
            sm: {
                root: "h-5 w-9 p-[2px]",
                switch: cx("size-4", isSelected && "translate-x-4"),
            },
            md: {
                root: "h-[22px] w-10 p-[2px]",
                switch: cx("size-[18px]", isSelected && "translate-x-[18px]"),
            },
        },
    };

    const classes = slim ? styles.slim[size] : styles.default[size];

    return (
        <div
            className={cx(
                "cursor-pointer rounded-full border border-[#d7dde7] bg-[#e5e9f0] transition-[background-color,border-color,box-shadow] duration-200 ease-out",
                isHovered && !isSelected && !isDisabled && "border-[#c8d1de] bg-[#dde3ec]",
                isSelected && "border-[var(--accent)] bg-[var(--accent)]",
                isSelected && isHovered && "brightness-95",
                isDisabled && "cursor-not-allowed border-[#e3e7ee] bg-[#edf1f6] opacity-70",
                isFocusVisible && "outline outline-2 outline-offset-2 outline-[var(--accent)]",

                slim && "shadow-none",
                classes.root,
                className,
            )}
        >
            <div
                style={{
                    transition: "transform 0.18s ease-out, translate 0.18s ease-out, border-color 0.18s ease-out, background-color 0.18s ease-out",
                }}
                className={cx(
                    "rounded-full border border-[#d4dbe6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.14)]",
                    isSelected && "border-white/80",
                    isDisabled && "border-[#dde3eb] bg-white",

                    classes.switch,
                )}
            />
        </div>
    );
};

interface ToggleProps extends AriaSwitchProps {
    size?: "sm" | "md";
    label?: string;
    hint?: ReactNode;
    slim?: boolean;
}

export const Toggle = ({ label, hint, className, size = "sm", slim, ...ariaSwitchProps }: ToggleProps) => {
    const generatedId = useId().replace(/:/g, "");
    const labelSlug = typeof label === "string"
        ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        : "toggle";
    const resolvedId = ariaSwitchProps.id ?? `${labelSlug || "toggle"}-${generatedId}`;
    const resolvedName = ariaSwitchProps.name ?? `${labelSlug || "toggle"}-${generatedId}`;
    const resolvedLabelId = !ariaSwitchProps["aria-label"] && label ? `${resolvedId}-label` : ariaSwitchProps["aria-labelledby"];
    const resolvedAriaLabel = ariaSwitchProps["aria-label"] ?? (typeof label === "string" ? label : undefined);

    const sizes = {
        sm: {
            root: "gap-2",
            textWrapper: "",
            label: "text-sm font-medium",
            hint: "text-sm",
        },
        md: {
            root: "gap-3",
            textWrapper: "gap-0.5",
            label: "text-md font-medium",
            hint: "text-md",
        },
    };

    return (
        <AriaSwitch
            {...ariaSwitchProps}
            id={resolvedId}
            name={resolvedName}
            aria-label={resolvedAriaLabel}
            aria-labelledby={resolvedLabelId}
            className={(renderProps) =>
                cx(
                    "flex w-max items-start",
                    renderProps.isDisabled && "cursor-not-allowed",
                    sizes[size].root,
                    typeof className === "function" ? className(renderProps) : className,
                )
            }
        >
            {({ isSelected, isDisabled, isFocusVisible, isHovered }) => (
                <>
                    <ToggleBase
                        slim={slim}
                        size={size}
                        isHovered={isHovered}
                        isDisabled={isDisabled}
                        isFocusVisible={isFocusVisible}
                        isSelected={isSelected}
                        className={slim ? "mt-0.5" : ""}
                    />

                    {(label || hint) && (
                        <div className={cx("flex flex-col", sizes[size].textWrapper)}>
                            {label && <p id={typeof resolvedLabelId === "string" ? resolvedLabelId : undefined} className={cx("text-secondary select-none", sizes[size].label)}>{label}</p>}
                            {hint && (
                                <span className={cx("text-tertiary", sizes[size].hint)} onClick={(event) => event.stopPropagation()}>
                                    {hint}
                                </span>
                            )}
                        </div>
                    )}
                </>
            )}
        </AriaSwitch>
    );
};
