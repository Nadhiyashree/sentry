using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace Billing
{
    // ⚠ SRP violation: This class handles invoicing, emailing, PDF generation, and DB access
    public class InvoiceService
    {
        private SqlConnection _connection;
        private string _smtpServer = "smtp.company.com";

        public InvoiceService()
        {
            // ⚠ Hard-coded connection string (not injected)
            _connection = new SqlConnection("Server=prod-db;Database=Billing;User Id=sa;Password=P@ssw0rd;");
        }

        // ⚠ async void — exceptions will crash the process silently
        public async void ProcessInvoice(int invoiceId)
        {
            var invoice = GetInvoice(invoiceId);

            // ⚠ No null check before accessing properties
            Console.WriteLine($"Processing invoice for: {invoice.CustomerName}");

            await SendInvoiceEmail(invoice);
            SavePdfToDisk(invoice);
            UpdateDatabase(invoice);
        }

        // ⚠ Synchronous DB call, no using/dispose, no null return guard
        public Invoice GetInvoice(int id)
        {
            _connection.Open();
            var cmd = new SqlCommand($"SELECT * FROM Invoices WHERE Id = {id}", _connection);
            var reader = cmd.ExecuteReader();

            if (reader.Read())
            {
                return new Invoice
                {
                    Id = (int)reader["Id"],
                    CustomerName = (string)reader["CustomerName"],
                    Amount = (decimal)reader["Amount"]
                };
            }

            // ⚠ Returns null — callers are not protected
            return null;
        }

        // ⚠ OCP violation: adding a new format requires modifying this method
        public string GenerateInvoiceContent(Invoice invoice, string format)
        {
            if (format == "html")
            {
                return $"<h1>Invoice #{invoice.Id}</h1><p>{invoice.CustomerName}: ${invoice.Amount}</p>";
            }
            else if (format == "text")
            {
                return $"Invoice #{invoice.Id}\n{invoice.CustomerName}: ${invoice.Amount}";
            }
            else if (format == "csv")
            {
                return $"{invoice.Id},{invoice.CustomerName},{invoice.Amount}";
            }

            return "";
        }

        // ⚠ Not awaited properly — .Result blocks the thread and can deadlock
        public async Task SendInvoiceEmail(Invoice invoice)
        {
            using var client = new HttpClient();
            var response = client.GetAsync($"http://{_smtpServer}/send?to={invoice.CustomerName}").Result;

            if (!response.IsSuccessStatusCode)
                Console.WriteLine("Email failed");
        }

        // ⚠ DIP violation: directly depends on File system, not an abstraction
        public void SavePdfToDisk(Invoice invoice)
        {
            string path = $"C:\\Invoices\\{invoice.Id}.pdf";
            File.WriteAllText(path, $"PDF content for {invoice.CustomerName}");
        }

        // ⚠ No transaction, no error handling, raw SQL (SQL injection risk)
        public void UpdateDatabase(Invoice invoice)
        {
            var cmd = new SqlCommand(
                $"UPDATE Invoices SET Status='Sent' WHERE Id = {invoice.Id}",
                _connection
            );
            cmd.ExecuteNonQuery();
        }

        // ⚠ ISP violation: interface would force all implementors to implement unrelated methods
        public void ArchiveInvoice(int invoiceId) { /* TODO */ }
        public void GenerateMonthlyReport() { /* TODO */ }
        public List<Invoice> GetAllCustomers() { return new List<Invoice>(); }
    }

    public class Invoice
    {
        public int Id { get; set; }
        public string CustomerName { get; set; }
        public decimal Amount { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
