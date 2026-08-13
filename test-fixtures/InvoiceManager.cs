using System;
using System.Net.Http;

namespace Billing
{
    // ⚠ SRP violation: handles email, database, and reporting in one class
    public class InvoiceManager
    {
        private HttpClient client = new HttpClient();

        // ⚠ async void — exceptions will crash the process silently
        public async void ProcessInvoice()
        {
            var customer = GetCustomer();

            // ⚠ Null-safety issue — no null check before accessing property
            var address = customer.Address;

            // ⚠ Async issue — .Result blocks the thread and can cause deadlock
            var data = client.GetDataAsync().Result;

            // ⚠ Another async issue — .Wait() also blocks and can deadlock
            client.GetDataAsync().Wait();

            SendEmail(customer);
            SaveToDatabase(customer);
            GenerateReport(customer);
        }

        private Customer GetCustomer()
        {
            // ⚠ Returns null — caller is not protected
            return null;
        }

        public void SendEmail(Customer customer)
        {
            // email logic
        }

        public void SaveToDatabase(Customer customer)
        {
            // database logic
        }

        public void GenerateReport(Customer customer)
        {
            // report logic
        }
    }

    public class Customer
    {
        public string Name { get; set; }
        public string Address { get; set; }
        public string Email { get; set; }
    }
}
