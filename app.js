const { createApp } = Vue;

createApp({
    data() {
        return {
            selectedFloors: 10,
            selectedElevators: 2,
            floors: [],
            elevators: [],
            callQueue: [],
            passengers: [],
            nextCallId: 1,
            nextPassengerId: 1,
            animationSpeed: 300
        };
    },
    
    mounted() {
        this.initializeSimulation();
    },
    
    methods: {
        // Инициализация симуляции
        initializeSimulation() {
            this.floors = Array.from({ length: this.selectedFloors }, (_, i) => this.selectedFloors - i);
            this.elevators = Array.from({ length: this.selectedElevators }, (_, i) => ({
                id: i + 1,
                currentFloor: 1,
                targetFloor: 1,
                state: 'idle', // idle, moving, loading
                direction: null, // up, down
                queue: [],
                passengers: [],
                doorsOpen: false,
                isMoving: false
            }));
            this.callQueue = [];
            this.passengers = [];
        },
        
        // Сброс симуляции
        resetSimulation() {
            this.initializeSimulation();
        },
        
        // Вызов лифта
        callElevator(floor) {
            if (this.hasCallOnFloor(floor)) return;
            
            const call = {
                id: this.nextCallId++,
                floor: floor,
                timestamp: Date.now()
            };
            
            // Добавляем вызов в общую очередь
            this.callQueue.push(call);
            
            // Создаем пассажира на этаже
            this.passengers.push({
                id: this.nextPassengerId++,
                floor: floor,
                state: 'waiting' // waiting, picked_up, delivered
            });
            
            // Назначаем лифт
            this.assignElevator(call);
        },
        
        // Назначение оптимального лифта
        assignElevator(call) {
            let bestElevator = null;
            let minDistance = Infinity;
            
            for (let elevator of this.elevators) {
                if (elevator.state === 'idle') {
                    const distance = Math.abs(elevator.currentFloor - call.floor);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestElevator = elevator;
                    }
                } else if (elevator.state === 'moving' || elevator.state === 'loading') {
                    // Проверяем, может ли лифт подобрать пассажира по пути
                    if (this.canPickupOnWay(elevator, call.floor)) {
                        bestElevator = elevator;
                        break;
                    }
                }
            }
            
            // Если не нашли подходящий движущийся лифт, ищем ближайший свободный
            if (!bestElevator) {
                for (let elevator of this.elevators) {
                    if (elevator.state === 'idle') {
                        const distance = Math.abs(elevator.currentFloor - call.floor);
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestElevator = elevator;
                        }
                    }
                }
            }
            
            if (bestElevator) {
                bestElevator.queue.push(call);
                if (bestElevator.state === 'idle') {
                    this.moveElevator(bestElevator);
                }
            } else {
                // Если все лифты заняты, назначаем на лифт с наименьшей очередью
                let minQueueLength = Infinity;
                for (let elevator of this.elevators) {
                    if (elevator.queue.length < minQueueLength) {
                        minQueueLength = elevator.queue.length;
                        bestElevator = elevator;
                    }
                }
                if (bestElevator) {
                    bestElevator.queue.push(call);
                }
            }
        },
        
        // Проверка, может ли лифт подобрать пассажира по пути
        canPickupOnWay(elevator, floor) {
            if (elevator.queue.length === 0) return false;
            
            const currentFloor = elevator.currentFloor;
            const nextTarget = elevator.queue[0].floor;
            
            // Если лифт движется вверх и этаж между текущим и целевым
            if (nextTarget > currentFloor && floor > currentFloor && floor <= nextTarget) {
                return true;
            }
            
            // Если лифт движется вниз и этаж между текущим и целевым
            if (nextTarget < currentFloor && floor < currentFloor && floor >= nextTarget) {
                return true;
            }
            
            return false;
        },
        
        // Движение лифта
        async moveElevator(elevator) {
            if (elevator.queue.length === 0) {
                elevator.state = 'idle';
                return;
            }
            
            // Сортируем очередь по оптимальному маршруту
            this.optimizeElevatorQueue(elevator);
            
            while (elevator.queue.length > 0) {
                const nextCall = elevator.queue[0];
                const targetFloor = nextCall.floor;
                
                if (elevator.currentFloor !== targetFloor) {
                    await this.animateElevatorMovement(elevator, targetFloor);
                }
                
                // Прибыли на этаж
                await this.handleElevatorArrival(elevator, nextCall);
                
                // Удаляем выполненный вызов
                elevator.queue.shift();
                this.removeFromCallQueue(nextCall.id);
                
                // Проверяем, есть ли еще вызовы по пути вниз к первому этажу
                await this.checkForPickupsOnWayDown(elevator);
            }
            
            // После выполнения всех вызовов, везем пассажиров на первый этаж
            if (elevator.passengers.length > 0 && elevator.currentFloor !== 1) {
                await this.animateElevatorMovement(elevator, 1);
                await this.handlePassengerDropoff(elevator);
            }
            
            elevator.state = 'idle';
        },
        
        // Проверка попутчиков по пути вниз к первому этажу
        async checkForPickupsOnWayDown(elevator) {
            if (elevator.passengers.length === 0) return;
            
            // Ищем вызовы между текущим этажом и первым этажом
            const availableCalls = this.callQueue.filter(call => 
                call.floor < elevator.currentFloor && call.floor > 1 &&
                !elevator.queue.some(queueCall => queueCall.id === call.id)
            );
            
            if (availableCalls.length > 0) {
                // Сортируем по убыванию этажа (сначала ближайшие к текущему этажу)
                availableCalls.sort((a, b) => b.floor - a.floor);
                
                // Добавляем в очередь лифта
                for (const call of availableCalls) {
                    elevator.queue.push(call);
                }
                
                // Сортируем очередь по убыванию этажа для движения вниз
                elevator.queue.sort((a, b) => b.floor - a.floor);
            }
        },
        
        // Оптимизация очереди лифта
        optimizeElevatorQueue(elevator) {
            if (elevator.queue.length <= 1) return;
            
            // Сортируем вызовы по направлению движения
            elevator.queue.sort((a, b) => {
                const currentFloor = elevator.currentFloor;
                const distanceA = Math.abs(a.floor - currentFloor);
                const distanceB = Math.abs(b.floor - currentFloor);
                return distanceA - distanceB;
            });
        },
        
        // Анимация движения лифта
        async animateElevatorMovement(elevator, targetFloor) {
            elevator.state = 'moving';
            elevator.targetFloor = targetFloor;
            elevator.direction = targetFloor > elevator.currentFloor ? 'up' : 'down';
            elevator.isMoving = true;
            
            const startFloor = elevator.currentFloor;
            const distance = Math.abs(targetFloor - startFloor);
            const direction = targetFloor > startFloor ? 1 : -1;
            
            // Более плавная анимация с улучшенным ускорением и торможением
            for (let i = 1; i <= distance; i++) {
                const progress = i / distance;
                let speed = this.animationSpeed;
                
                // Более плавное ускорение (первые 40% пути)
                if (progress <= 0.4) {
                    const accelProgress = progress / 0.4;
                    speed = this.animationSpeed * (0.3 + accelProgress * 0.7); // от 0.3 до 1
                }
                // Постоянная скорость (средние 20% пути)
                else if (progress <= 0.6) {
                    speed = this.animationSpeed;
                }
                // Более плавное торможение (последние 40% пути)
                else {
                    const brakeProgress = (progress - 0.6) / 0.4;
                    speed = this.animationSpeed * (1 - brakeProgress * 0.7); // от 1 до 0.3
                }
                
                await this.delay(speed);
                elevator.currentFloor = startFloor + (i * direction);
                
                // Проверяем попутчиков на каждом этаже
                await this.checkForPickups(elevator);
            }
            
            elevator.isMoving = false;
        },
        
        // Проверка попутчиков
        async checkForPickups(elevator) {
            const currentFloor = elevator.currentFloor;
            
            // Ищем вызовы на текущем этаже, которые можно подобрать
            for (let i = 0; i < elevator.queue.length; i++) {
                const call = elevator.queue[i];
                if (call.floor === currentFloor) {
                    // Останавливаемся и подбираем пассажира
                    await this.handleElevatorArrival(elevator, call);
                    elevator.queue.splice(i, 1);
                    this.removeFromCallQueue(call.id);
                    break;
                }
            }
            
            // Также проверяем вызовы, которые не в очереди этого лифта, но на текущем этаже
            const callOnCurrentFloor = this.callQueue.find(call => 
                call.floor === currentFloor && 
                !elevator.queue.some(queueCall => queueCall.id === call.id)
            );
            
            if (callOnCurrentFloor) {
                await this.handleElevatorArrival(elevator, callOnCurrentFloor);
                this.removeFromCallQueue(callOnCurrentFloor.id);
            }
        },
        
        // Обработка прибытия лифта
        async handleElevatorArrival(elevator, call) {
            elevator.state = 'loading';
            elevator.doorsOpen = true;
            
            // Подбираем пассажира
            const passenger = this.passengers.find(p => p.floor === call.floor && p.state === 'waiting');
            if (passenger) {
                passenger.state = 'picked_up';
                elevator.passengers.push(passenger);
            }
            
            // Ждем загрузки
            await this.delay(1000);
            
            elevator.doorsOpen = false;
            await this.delay(300); // Время закрытия дверей
        },
        
        // Высадка пассажиров на первом этаже
        async handlePassengerDropoff(elevator) {
            elevator.state = 'loading';
            elevator.doorsOpen = true;
            
            // Высаживаем всех пассажиров
            for (const passenger of elevator.passengers) {
                passenger.state = 'delivered';
            }
            
            // Удаляем доставленных пассажиров
            this.passengers = this.passengers.filter(p => p.state !== 'delivered');
            elevator.passengers = [];
            
            await this.delay(1000);
            
            elevator.doorsOpen = false;
            await this.delay(300);
        },
        
        // Удаление вызова из очереди
        removeFromCallQueue(callId) {
            this.callQueue = this.callQueue.filter(call => call.id !== callId);
        },
        
        // Проверка наличия вызова на этаже
        hasCallOnFloor(floor) {
            return this.callQueue.some(call => call.floor === floor);
        },
        
        // Проверка наличия пассажира на этаже
        hasPassengerOnFloor(floor) {
            return this.passengers.some(p => p.floor === floor && p.state === 'waiting');
        },
        
        // Стили для лифта
        elevatorStyle(elevator) {
            return {
                transition: elevator.isMoving ? 'none' : 'all 0.3s ease'
            };
        },
        
        // Задержка
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }
}).mount('#app');

