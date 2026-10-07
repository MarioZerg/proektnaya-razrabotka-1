using System;
using System.Drawing;
using System.Windows.Forms;

namespace YarplanLider
{
    /// <summary>
    /// Выход с телевизора только по PIN из kiosk.ini — чтобы с пульта или клавиатуры
    /// нельзя было закрыть экран цеха.
    /// </summary>
    internal sealed class PinForm : Form
    {
        private readonly string _pin;
        private readonly TextBox _box;
        public bool Accepted { get; private set; }

        public PinForm(string pin)
        {
            _pin = pin ?? "";
            Text = "Выход";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            TopMost = true;
            ClientSize = new Size(360, 150);
            Font = new Font("Segoe UI", 14f);

            var label = new Label
            {
                AutoSize = false,
                Text = "PIN для выхода с экрана цеха",
                Location = new Point(16, 16),
                Size = new Size(328, 28),
            };
            _box = new TextBox
            {
                Location = new Point(16, 52),
                Size = new Size(328, 32),
                UseSystemPasswordChar = true,
                MaxLength = 12,
            };
            var ok = new Button
            {
                Text = "Выйти",
                DialogResult = DialogResult.OK,
                Location = new Point(160, 100),
                Size = new Size(88, 32),
            };
            var cancel = new Button
            {
                Text = "Отмена",
                DialogResult = DialogResult.Cancel,
                Location = new Point(256, 100),
                Size = new Size(88, 32),
            };
            AcceptButton = ok;
            CancelButton = cancel;
            Controls.Add(label);
            Controls.Add(_box);
            Controls.Add(ok);
            Controls.Add(cancel);
            Shown += (s, e) => _box.Focus();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (DialogResult == DialogResult.OK)
            {
                Accepted = string.Equals(_box.Text.Trim(), _pin, StringComparison.Ordinal);
                if (!Accepted)
                {
                    e.Cancel = true;
                    _box.Clear();
                    _box.Focus();
                    MessageBox.Show(this, "Неверный PIN", "Выход", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            base.OnFormClosing(e);
        }
    }
}
