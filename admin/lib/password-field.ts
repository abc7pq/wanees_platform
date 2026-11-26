import { createElement, type ChangeEvent } from "react";

type PasswordFieldProps = {
  value?: string;
  disabled: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function PasswordField({ value, disabled, onChange }: PasswordFieldProps) {
  return createElement(
    "div",
    null,
    createElement("label", { htmlFor: "admin-password" }, "كلمة المرور"),
    createElement("input", {
      id: "admin-password",
      name: "password",
      type: "password",
      value,
      onChange,
      autoComplete: "current-password",
      required: true,
      disabled,
    }),
  );
}
