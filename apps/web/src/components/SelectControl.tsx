import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	type AriaAttributes,
	Children,
	isValidElement,
	type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__signoff_empty__";

type OptionProps = {
	value?: string | number;
	children?: ReactNode;
	disabled?: boolean;
};

export function SelectControl({
	id,
	value,
	onChange,
	children,
	disabled,
	className,
	contentClassName,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	"aria-required": ariaRequired,
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	children: ReactNode;
	disabled?: boolean;
	className?: string;
	contentClassName?: string;
	"aria-label"?: string;
	"aria-labelledby"?: AriaAttributes["aria-labelledby"];
	"aria-describedby"?: AriaAttributes["aria-describedby"];
	"aria-invalid"?: AriaAttributes["aria-invalid"];
	"aria-required"?: AriaAttributes["aria-required"];
}) {
	const options = Children.toArray(children).flatMap((child) => {
		if (!isValidElement<OptionProps>(child)) return [];
		const optionValue = String(child.props.value ?? "");
		return [
			{
				value: optionValue,
				label: child.props.children,
				disabled: child.props.disabled,
			},
		];
	});

	return (
		<Select
			value={value === "" ? EMPTY_VALUE : value}
			onValueChange={(next) => onChange(next === EMPTY_VALUE ? "" : next)}
		>
			<SelectTrigger
				id={id}
				disabled={disabled}
				className={cn(
					"gap-2 whitespace-nowrap [&>span]:truncate [&>svg]:shrink-0",
					className,
				)}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid}
				aria-required={ariaRequired}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent
				className={cn(
					"w-max min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)]",
					contentClassName,
				)}
			>
				{options.map((option) => (
					<SelectItem
						key={option.value || EMPTY_VALUE}
						value={option.value || EMPTY_VALUE}
						disabled={option.disabled}
						className="whitespace-nowrap [&>span:first-child]:truncate"
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
