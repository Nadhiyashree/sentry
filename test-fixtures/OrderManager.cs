using System;
using System.Threading.Tasks;

namespace Billing
{
    // ⚠ SRP violation: handles notifications, database, and invoicing in one class
    public class OrderManager
    {
        private DatabaseClient database = new DatabaseClient();

        // ⚠ async void — exceptions will crash the process silently
        public async void ProcessOrder()
        {
            var order = GetOrder();

            // ⚠ Null-safety issue — no null check on order or order.Customer before accessing Name
            var customerName = order.Customer.Name;

            // ⚠ Async issue — .Result blocks the thread and can cause deadlock
            var result = database.GetOrdersAsync().Result;

            // ⚠ Another async issue — .Wait() also blocks and can deadlock
            database.SaveOrderAsync().Wait();

            SendNotification(order);
            SaveOrder(order);
            CreateInvoice(order);
        }

        private Order GetOrder()
        {
            // ⚠ Returns null — caller is not protected
            return null;
        }

        public void SendNotification(Order order)
        {
            // notification logic
        }

        public void SaveOrder(Order order)
        {
            // database logic
        }

        public void CreateInvoice(Order order)
        {
            // invoice logic
        }
    }

    public class Order
    {
        public int Id { get; set; }
        public Customer Customer { get; set; }
        public decimal Total { get; set; }
    }

    public class DatabaseClient
    {
        public Task<object> GetOrdersAsync() => Task.FromResult<object>(null);
        public Task SaveOrderAsync() => Task.CompletedTask;
    }
}
